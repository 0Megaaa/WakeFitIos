import { classifySquatPoseFrame, THRESHOLDS, type SquatPoseClassification } from './squatPoseClassifier.ts';
import { normalizeTargetCount } from '../alarm/alarm.ts';
import type {
  PoseFrame,
  PushUpPhase,
  PushUpCounter,
  PushUpCounterOptions,
  PushUpCounterResult,
  SquatCounterOptions,
  PoseLandmarkName,
} from './types.ts';

export type { PoseLandmarkName, Point, PoseLandmark, PoseFrame, PushUpPhase } from './types.ts';
export type { PushUpCounterOptions, SquatCounterOptions, PushUpCounterResult, PushUpCounter } from './types.ts';

const DEFAULT_TARGET_COUNT = 5;
const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_MIN_STABLE_FRAMES = 2;
const SQUAT_MIN_STABLE_FRAMES = 3;
const BASELINE_SAMPLE_COUNT = 3;

// Default timeouts (used for ML Kit)
const MAX_TRANSITION_DURATION_MS = 2000;
const INVALID_DURATION_THRESHOLD_MS = 700;

// Apple Vision specific timeouts (relaxed)
const APPLE_VISION_MAX_TRANSITION_DURATION_MS = 3500;
const APPLE_VISION_INVALID_DURATION_THRESHOLD_MS = 1500;
// Apple Vision requires only 2 stable frames for squat detection
const APPLE_VISION_SQUAT_MIN_STABLE_FRAMES = 2;

// Apple Vision Push-up relaxed defaults
const APPLE_VISION_PUSHUP_MIN_CONFIDENCE = 0.35;
const APPLE_VISION_PUSHUP_DOWN_ANGLE = 135;
const APPLE_VISION_PUSHUP_UP_ANGLE = 150;

// Relative elbow fallback thresholds for Apple Vision
const APPLE_VISION_RELATIVE_DOWN_DELTA = 25;
const APPLE_VISION_RELATIVE_DOWN_MAX_ANGLE = 145;

// Calibration constants
const CALIBRATION_MIN_STABLE_FRAMES = 4;
const CALIBRATION_ARM_MIN_CONFIDENCE = 0.35;
const CALIBRATION_ARM_AUX_CONFIDENCE = 0.30; // For hip/knee/ankle辅助
const CALIBRATION_MIN_ELBOW_ANGLE = 145; // Arm should be mostly extended
const CALIBRATION_STANDING_REJECT_FRAMES = 3;

export function calculateAngle(a: { x: number; y: number }, vertex: { x: number; y: number }, c: { x: number; y: number }): number {
  const ab = { x: a.x - vertex.x, y: a.y - vertex.y };
  const cb = { x: c.x - vertex.x, y: c.y - vertex.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const length = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (length === 0) {
    return 180;
  }
  return (Math.acos(Math.min(1, Math.max(-1, dot / length))) * 180) / Math.PI;
}

export function createPushUpCounter(options: PushUpCounterOptions = {}): PushUpCounter {
  const targetCount = normalizeTargetCount(options.targetCount);

  // Store explicit config to distinguish from defaults
  const configuredMinConfidence = options.minConfidence;
  const configuredDownAngle = options.downAngle;
  const configuredUpAngle = options.upAngle;

  const minStableFrames = Math.max(1, Math.trunc(options.minStableFrames ?? DEFAULT_MIN_STABLE_FRAMES));

  // Counting state
  let count = 0;
  let phase: PushUpPhase = 'waiting_for_body';
  let lastElbowAngle: number | null = null;
  let candidatePose: 'up' | 'down' | null = null;
  let candidateFrames = 0;

  // Apple Vision specific counting state
  let appleVisionUpBaselineAngle: number | null = null;
  let appleVisionUpBaselineSide: 'left' | 'right' | null = null; // V1.8.5: track which side the baseline belongs to
  let appleVisionActiveSide: 'left' | 'right' | null = null;

  // Grace timeout for temporary arm loss
  let lastValidArmTimestampMs: number | null = null;
  let invalidStartTimestampMs: number | null = null;

  // V1.8: Calibration state
  type CalibrationMode = 'front' | 'side';
  let calibrationMode: CalibrationMode | null = null;
  let calibrationCandidate: CalibrationMode | null = null;
  let calibrationCandidateSide: 'left' | 'right' | null = null; // V1.8.2: track which side
  let calibrationFrames = 0;
  let calibrationMissFrames = 0; // V1.8.1: 1-frame miss tolerance
  let calibratedSide: 'left' | 'right' | null = null; // V1.8.4: locked side for SIDE calibration
  let standingRejectFrames = 0;

  function isAppleVision(frame: PoseFrame): boolean {
    return frame.source === 'apple-vision';
  }

  /**
   * Get effective minimum confidence for the frame.
   * Apple Vision uses lower threshold (0.35) for push-up.
   * Explicit configuration takes priority.
   */
  function getEffectiveMinConfidence(frame: PoseFrame): number {
    if (configuredMinConfidence !== undefined) {
      return configuredMinConfidence;
    }
    return isAppleVision(frame) ? APPLE_VISION_PUSHUP_MIN_CONFIDENCE : DEFAULT_MIN_CONFIDENCE;
  }

  /**
   * Get effective down angle for the frame.
   * Apple Vision uses relaxed threshold (135°) for push-up.
   * Explicit configuration takes priority.
   */
  function getEffectiveDownAngle(frame: PoseFrame): number {
    if (configuredDownAngle !== undefined) {
      return configuredDownAngle;
    }
    return isAppleVision(frame) ? APPLE_VISION_PUSHUP_DOWN_ANGLE : 90;
  }

  /**
   * Get effective up angle for the frame.
   * Apple Vision uses relaxed threshold (150°) for push-up.
   * Explicit configuration takes priority.
   */
  function getEffectiveUpAngle(frame: PoseFrame): number {
    if (configuredUpAngle !== undefined) {
      return configuredUpAngle;
    }
    return isAppleVision(frame) ? APPLE_VISION_PUSHUP_UP_ANGLE : 160;
  }

  /**
   * Get invalid threshold for the frame.
   * Apple Vision uses longer timeout (1500ms) for push-up.
   */
  function getInvalidThreshold(frame: PoseFrame): number {
    return isAppleVision(frame) ? APPLE_VISION_INVALID_DURATION_THRESHOLD_MS : INVALID_DURATION_THRESHOLD_MS;
  }

  function currentResult(isPoseReady: boolean): PushUpCounterResult {
    return {
      count,
      phase,
      isPoseReady,
      isComplete: count >= targetCount,
      elbowAngle: lastElbowAngle,
    };
  }

  /**
   * Helper to get landmarks by name from frame
   */
  function getLandmarks(frame: PoseFrame): Map<string, { x: number; y: number; confidence: number }> {
    const byName = new Map<string, { x: number; y: number; confidence: number }>();
    for (const item of frame.landmarks) {
      byName.set(item.name, item);
    }
    return byName;
  }

  /**
   * Check if a side has a valid arm chain for calibration.
   * Apple Vision only requires shoulder + elbow + wrist.
   * Returns null if not valid, or the arm data if valid.
   */
  function hasArmChainForCalibration(
    byName: Map<string, { x: number; y: number; confidence: number }>,
    side: 'left' | 'right',
  ): { shoulder: { x: number; y: number; confidence: number }; elbow: { x: number; y: number; confidence: number }; wrist: { x: number; y: number; confidence: number } } | null {
    const shoulder = byName.get(`${side}Shoulder`);
    const elbow = byName.get(`${side}Elbow`);
    const wrist = byName.get(`${side}Wrist`);

    if (!shoulder || !elbow || !wrist) {
      return null;
    }

    if (
      shoulder.confidence < CALIBRATION_ARM_MIN_CONFIDENCE ||
      elbow.confidence < CALIBRATION_ARM_MIN_CONFIDENCE ||
      wrist.confidence < CALIBRATION_ARM_MIN_CONFIDENCE
    ) {
      return null;
    }

    return { shoulder, elbow, wrist };
  }

  /**
   * Check if this side has sufficient arm chain for counting.
   * Apple Vision only requires shoulder + elbow + wrist (no hip required).
   * ML Kit requires hip for backward compatibility.
   */
  function hasValidArmSide(
    frame: PoseFrame,
    side: 'left' | 'right',
    minConfidence: number,
  ): boolean {
    const byName = getLandmarks(frame);

    const shoulder = byName.get(`${side}Shoulder`);
    const elbow = byName.get(`${side}Elbow`);
    const wrist = byName.get(`${side}Wrist`);

    if (!shoulder || !elbow || !wrist) {
      return false;
    }

    if (
      shoulder.confidence < minConfidence ||
      elbow.confidence < minConfidence ||
      wrist.confidence < minConfidence
    ) {
      return false;
    }

    // Apple Vision: only need shoulder + elbow + wrist
    if (isAppleVision(frame)) {
      return true;
    }

    // ML Kit: also require hip for push-up
    const hip = byName.get(`${side}Hip`);
    if (!hip || hip.confidence < minConfidence) {
      return false;
    }

    return true;
  }

  /**
   * Check if frame represents a clearly standing pose.
   * Used to reject standing poses during calibration.
   * Uses normalized geometry (not fixed pixels).
   * Supports multi-level standing chain when some lower body points are missing.
   */
  function isClearlyStandingPose(
    byName: Map<string, { x: number; y: number; confidence: number }>,
    frame: PoseFrame,
  ): boolean {
    // Use imageHeight for normalization
    const imageHeight = frame.imageHeight || 640;
    const normalizeThreshold = 0.15; // ~15% of image height minimum for standing

    const getAux = (name: string) => byName.get(name);
    const sides: Array<'left' | 'right'> = ['left', 'right'];
    let standingScore = 0;

    for (const side of sides) {
      const shoulder = getAux(`${side}Shoulder`);
      const hip = getAux(`${side}Hip`);
      const knee = getAux(`${side}Knee`);
      const ankle = getAux(`${side}Ankle`);

      let thisSideStanding = false;

      // Priority A: Full chain shoulder → hip → knee → ankle
      if (shoulder && hip && knee && ankle &&
          shoulder.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
          hip.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
          knee.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
          ankle.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE) {

        const verticalSpan = ankle.y - shoulder.y;
        const normalizedSpan = verticalSpan / imageHeight;

        // Check y-order: shoulder < hip < knee < ankle
        const yOrderValid = shoulder.y < hip.y && hip.y < knee.y && knee.y < ankle.y;

        // Check x-alignment: body should be vertical (x should be similar)
        const bodyXSpan = Math.abs(ankle.x - shoulder.x);
        const xRatio = bodyXSpan / Math.max(verticalSpan, 1);

        if (yOrderValid && normalizedSpan >= normalizeThreshold && xRatio <= 0.5) {
          thisSideStanding = true;
        }
      }
      // Priority B: shoulder → hip → knee (3 points)
      else if (shoulder && hip && knee &&
               shoulder.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
               hip.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
               knee.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE) {

        const verticalSpan = knee.y - shoulder.y;
        const normalizedSpan = verticalSpan / imageHeight;

        const yOrderValid = shoulder.y < hip.y && hip.y < knee.y;
        const bodyXSpan = Math.abs(knee.x - shoulder.x);
        const xRatio = bodyXSpan / Math.max(verticalSpan, 1);

        if (yOrderValid && normalizedSpan >= normalizeThreshold && xRatio <= 0.5) {
          thisSideStanding = true;
        }
      }
      // Priority C: hip → knee → ankle (3 points)
      else if (hip && knee && ankle &&
               hip.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
               knee.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
               ankle.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE) {

        const verticalSpan = ankle.y - hip.y;
        const normalizedSpan = verticalSpan / imageHeight;

        const yOrderValid = hip.y < knee.y && knee.y < ankle.y;
        const bodyXSpan = Math.abs(ankle.x - hip.x);
        const xRatio = bodyXSpan / Math.max(verticalSpan, 1);

        if (yOrderValid && normalizedSpan >= normalizeThreshold && xRatio <= 0.5) {
          thisSideStanding = true;
        }
      }

      if (thisSideStanding) {
        standingScore++;
      }
    }

    // Require clear standing on at least one side
    return standingScore >= 1;
  }

  /**
   * Check if frame meets FRONT calibration criteria.
   * Front mode: head facing camera, body along depth axis.
   * HARD RULE: Must have BOTH left and right arm chains visible and extended.
   */
  function checkFrontCalibration(
    byName: Map<string, { x: number; y: number; confidence: number }>,
  ): boolean {
    const leftArm = hasArmChainForCalibration(byName, 'left');
    const rightArm = hasArmChainForCalibration(byName, 'right');

    // HARD REQUIREMENT: Both arms must exist
    if (!leftArm || !rightArm) {
      return false;
    }

    // Both elbows should be extended (>145 degrees)
    const leftAngle = calculateAngle(leftArm.shoulder, leftArm.elbow, leftArm.wrist);
    const rightAngle = calculateAngle(rightArm.shoulder, rightArm.elbow, rightArm.wrist);

    if (leftAngle < CALIBRATION_MIN_ELBOW_ANGLE || rightAngle < CALIBRATION_MIN_ELBOW_ANGLE) {
      return false;
    }

    // Wrists should be below shoulders (in plank position)
    if (leftArm.wrist.y <= leftArm.shoulder.y || rightArm.wrist.y <= rightArm.shoulder.y) {
      return false;
    }

    // Elbows should be between shoulder and wrist vertically
    if (leftArm.elbow.y <= leftArm.shoulder.y || leftArm.elbow.y >= leftArm.wrist.y) {
      return false;
    }
    if (rightArm.elbow.y <= rightArm.shoulder.y || rightArm.elbow.y >= rightArm.wrist.y) {
      return false;
    }

    // Shoulders should be roughly at same height (normalized)
    const shoulderYDiff = Math.abs(leftArm.shoulder.y - rightArm.shoulder.y);
    const armLength = Math.hypot(
      leftArm.shoulder.x - leftArm.wrist.x,
      leftArm.shoulder.y - leftArm.wrist.y,
    );
    if (armLength > 0 && shoulderYDiff / armLength > 0.3) {
      return false; // Shoulders too uneven
    }

    // Wrists should be reasonably separated (normalized)
    const wristWidth = Math.abs(leftArm.wrist.x - rightArm.wrist.x);
    const shoulderWidth = Math.abs(leftArm.shoulder.x - rightArm.shoulder.x);
    if (shoulderWidth > 0) {
      const wristRatio = wristWidth / shoulderWidth;
      if (wristRatio < 0.5 || wristRatio > 2.5) {
        return false; // Wrists too close or too far apart
      }
    }

    return true;
  }

  /**
   * Check if a single side meets SIDE calibration criteria.
   * Returns 'left' or 'right' if that side qualifies, null otherwise.
   */
  function checkSideCalibrationForSide(
    byName: Map<string, { x: number; y: number; confidence: number }>,
    side: 'left' | 'right',
  ): boolean {
    const arm = hasArmChainForCalibration(byName, side);
    if (!arm) {
      return false;
    }

    // Elbow should be extended
    const elbowAngle = calculateAngle(arm.shoulder, arm.elbow, arm.wrist);
    if (elbowAngle < CALIBRATION_MIN_ELBOW_ANGLE) {
      return false;
    }

    // Wrist should be below shoulder (plank position)
    if (arm.wrist.y <= arm.shoulder.y) {
      return false;
    }

    // HARD REQUIREMENT: Same-side hip must exist
    const hip = byName.get(`${side}Hip`);
    if (!hip || hip.confidence < CALIBRATION_ARM_AUX_CONFIDENCE) {
      return false;
    }

    // Check if body axis is more horizontal than vertical
    // shoulder → hip should be primarily horizontal
    const dx = Math.abs(hip.x - arm.shoulder.x);
    const dy = Math.abs(hip.y - arm.shoulder.y);

    // Use normalized geometry: armLength for scale invariance
    const armLength = Math.hypot(
      arm.wrist.x - arm.shoulder.x,
      arm.wrist.y - arm.shoulder.y,
    );

    // bodyHorizontalRatio should be meaningful (not near zero relative to arm length)
    const bodyHorizontalRatio = dx / Math.max(armLength, 1);
    if (bodyHorizontalRatio < 0.15) {
      return false; // Too vertical relative to arm
    }

    // Normalized ratio: dy/dx <= 0.8
    if (dx > 0 && dy / dx > 0.8) {
      return false; // Too vertical
    }

    // Knee/Ankle are optional but can enhance verification
    const knee = byName.get(`${side}Knee`);
    const ankle = byName.get(`${side}Ankle`);

    // If hip + knee both available, check hip → knee is also horizontal
    if (knee && knee.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE) {
      const hipKneeDx = Math.abs(knee.x - hip.x);
      const hipKneeDy = Math.abs(knee.y - hip.y);
      if (hipKneeDx > 0 && hipKneeDy / hipKneeDx > 0.8) {
        return false; // Too vertical
      }
    }

    // If knee + ankle both available, check knee → ankle is also horizontal
    if (knee && ankle &&
        knee.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE &&
        ankle.confidence >= CALIBRATION_ARM_AUX_CONFIDENCE) {
      const kneeAnkleDx = Math.abs(ankle.x - knee.x);
      const kneeAnkleDy = Math.abs(ankle.y - knee.y);
      if (kneeAnkleDx > 0 && kneeAnkleDy / kneeAnkleDx > 0.8) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if frame meets SIDE calibration criteria.
   * Side mode: body sideways to camera, horizontal body axis.
   * Returns 'left' or 'right' indicating which side qualifies, null if neither.
   */
  function checkSideCalibration(
    byName: Map<string, { x: number; y: number; confidence: number }>,
  ): 'left' | 'right' | null {
    const leftValid = checkSideCalibrationForSide(byName, 'left');
    const rightValid = checkSideCalibrationForSide(byName, 'right');

    // Only one side valid - use that side
    if (leftValid && !rightValid) {
      return 'left';
    }
    if (rightValid && !leftValid) {
      return 'right';
    }
    // Both sides valid - prefer current active side if still valid
    if (leftValid && rightValid) {
      if (appleVisionActiveSide === 'left' || appleVisionActiveSide === null) {
        return 'left';
      }
      return 'right';
    }

    return null;
  }

  /**
   * Clear all calibration state (but preserve count)
   */
  function clearCalibration(): void {
    calibrationMode = null;
    calibrationCandidate = null;
    calibrationCandidateSide = null;
    calibratedSide = null;
    calibrationFrames = 0;
    calibrationMissFrames = 0;
    standingRejectFrames = 0;
  }

  /**
   * Clear all counting state (but preserve count)
   */
  function clearCountingState(): void {
    phase = 'waiting_for_body';
    lastElbowAngle = null;
    candidatePose = null;
    candidateFrames = 0;
    appleVisionUpBaselineAngle = null;
    appleVisionUpBaselineSide = null; // V1.8.5
    appleVisionActiveSide = null;
    invalidStartTimestampMs = null;
    lastValidArmTimestampMs = null;
  }

  /**
   * Get the best confident arm side for the frame.
   */
  function getBestConfidentSide(
    frame: PoseFrame,
    minConfidence: number,
  ): { side: 'left' | 'right'; shoulder: { x: number; y: number; confidence: number }; elbow: { x: number; y: number; confidence: number }; wrist: { x: number; y: number; confidence: number } } | null {
    const hasLeft = hasValidArmSide(frame, 'left', minConfidence);
    const hasRight = hasValidArmSide(frame, 'right', minConfidence);

    if (!hasLeft && !hasRight) {
      return null;
    }

    // Stabilization: prefer current active side if still valid
    if (appleVisionActiveSide !== null) {
      const activeValid = hasValidArmSide(frame, appleVisionActiveSide, minConfidence);
      if (activeValid) {
        const landmarks = getSideLandmarks(frame, appleVisionActiveSide);
        if (landmarks) {
          return { side: appleVisionActiveSide, ...landmarks };
        }
      }
    }

    // Active side not available or not set, select the best available side
    if (hasLeft && !hasRight) {
      appleVisionActiveSide = 'left';
      const landmarks = getSideLandmarks(frame, 'left');
      if (landmarks) {
        return { side: 'left', ...landmarks };
      }
    }

    if (hasRight && !hasLeft) {
      appleVisionActiveSide = 'right';
      const landmarks = getSideLandmarks(frame, 'right');
      if (landmarks) {
        return { side: 'right', ...landmarks };
      }
    }

    // Both sides available - use the one with higher average confidence
    if (hasLeft && hasRight) {
      const leftAvg = getSideAverageConfidence(frame, 'left', minConfidence);
      const rightAvg = getSideAverageConfidence(frame, 'right', minConfidence);
      const chosen = leftAvg >= rightAvg ? 'left' : 'right';
      appleVisionActiveSide = chosen;
      const landmarks = getSideLandmarks(frame, chosen);
      if (landmarks) {
        return { side: chosen, ...landmarks };
      }
    }

    return null;
  }

  function getSideLandmarks(
    frame: PoseFrame,
    side: 'left' | 'right',
  ): { shoulder: { x: number; y: number; confidence: number }; elbow: { x: number; y: number; confidence: number }; wrist: { x: number; y: number; confidence: number } } | null {
    const byName = getLandmarks(frame);

    const shoulder = byName.get(`${side}Shoulder`);
    const elbow = byName.get(`${side}Elbow`);
    const wrist = byName.get(`${side}Wrist`);

    if (!shoulder || !elbow || !wrist) {
      return null;
    }

    return { shoulder, elbow, wrist };
  }

  function getSideAverageConfidence(
    frame: PoseFrame,
    side: 'left' | 'right',
    minConfidence: number,
  ): number {
    const byName = getLandmarks(frame);

    const shoulder = byName.get(`${side}Shoulder`);
    const elbow = byName.get(`${side}Elbow`);
    const wrist = byName.get(`${side}Wrist`);

    if (!shoulder || !elbow || !wrist) {
      return 0;
    }

    if (
      shoulder.confidence < minConfidence ||
      elbow.confidence < minConfidence ||
      wrist.confidence < minConfidence
    ) {
      return 0;
    }

    return (shoulder.confidence + elbow.confidence + wrist.confidence) / 3;
  }

  /**
   * Classify elbow pose using absolute and relative thresholds.
   * V1.8.5: Only apply relative fallback if baseline and current are same side.
   */
  function classifyElbowPoseForAppleVision(
    angle: number,
    absoluteDownAngle: number,
    upAngle: number,
    currentSide: 'left' | 'right' | null,
  ): 'up' | 'down' | null {
    if (angle >= upAngle) {
      return 'up';
    }

    if (angle <= absoluteDownAngle) {
      return 'down';
    }

    // V1.8.5: Check relative DOWN fallback only if baseline is from same side
    if (appleVisionUpBaselineAngle !== null && appleVisionUpBaselineSide === currentSide) {
      const delta = appleVisionUpBaselineAngle - angle;
      if (delta >= APPLE_VISION_RELATIVE_DOWN_DELTA && angle <= APPLE_VISION_RELATIVE_DOWN_MAX_ANGLE) {
        return 'down';
      }
    }

    return null;
  }

  /**
   * Classify elbow pose using only absolute thresholds (for ML Kit).
   */
  function classifyElbowPose(
    angle: number,
    downAngle: number,
    upAngle: number,
  ): 'up' | 'down' | null {
    if (angle >= upAngle) return 'up';
    if (angle < downAngle) return 'down';
    return null;
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      const minConfidence = getEffectiveMinConfidence(frame);
      const downAngle = getEffectiveDownAngle(frame);
      const upAngle = getEffectiveUpAngle(frame);
      const invalidThreshold = getInvalidThreshold(frame);
      const isAV = isAppleVision(frame);

      // Only Apple Vision has calibration
      if (!isAV) {
        // ML Kit: use V1.7.1 logic without calibration
        // ML Kit does NOT have grace period - immediate reset on no arm
        const side = getBestConfidentSide(frame, minConfidence);

        if (side) {
          lastValidArmTimestampMs = frame.timestampMs;
          invalidStartTimestampMs = null;
        }

        if (!side) {
          // ML Kit: immediate reset on no valid arm
          phase = 'waiting_for_body';
          lastElbowAngle = null;
          candidatePose = null;
          candidateFrames = 0;
          appleVisionUpBaselineAngle = null;
          appleVisionUpBaselineSide = null; // V1.8.5
          appleVisionActiveSide = null;
          invalidStartTimestampMs = null;
          lastValidArmTimestampMs = null;
          return currentResult(false);
        }

        lastElbowAngle = calculateAngle(side.shoulder, side.elbow, side.wrist);
        const observedPose = classifyElbowPose(lastElbowAngle, downAngle, upAngle);

        if (!observedPose) {
          candidatePose = null;
          candidateFrames = 0;
          return currentResult(true);
        }

        if (candidatePose === observedPose) {
          candidateFrames += 1;
        } else {
          candidatePose = observedPose;
          candidateFrames = 1;
        }

        if (candidateFrames < minStableFrames) {
          return currentResult(true);
        }

        if (observedPose === 'up') {
          if (phase === 'down') {
            count += 1;
          }
          phase = 'ready';
          return currentResult(true);
        }

        if (phase === 'ready' && observedPose === 'down') {
          phase = 'down';
        }

        return currentResult(true);
      }

      // ===== APPLE VISION PATH =====
      const byName = getLandmarks(frame);

      // Check for clearly standing pose (rejection)
      if (isClearlyStandingPose(byName, frame)) {
        standingRejectFrames++;

        if (standingRejectFrames >= CALIBRATION_STANDING_REJECT_FRAMES) {
          // User is clearly standing - clear calibration
          clearCalibration();
          clearCountingState();
          return currentResult(false);
        }
      } else {
        standingRejectFrames = 0;
      }

      // Track arm validity
      // V1.8.4: For SIDE calibration, lock to calibratedSide instead of dynamic selection
      // V1.8.5: Must check confidence, not just existence of landmarks
      let side: { side: 'left' | 'right'; shoulder: { x: number; y: number; confidence: number }; elbow: { x: number; y: number; confidence: number }; wrist: { x: number; y: number; confidence: number } } | null = null;

      if (calibrationMode === 'side' && calibratedSide !== null) {
        // V1.8.5: SIDE calibrated: first check if confidence is sufficient
        const calibratedArmIsValid = hasValidArmSide(frame, calibratedSide, minConfidence);
        if (calibratedArmIsValid) {
          const calibratedArm = getSideLandmarks(frame, calibratedSide);
          if (calibratedArm) {
            side = { side: calibratedSide, ...calibratedArm };
            // Update appleVisionActiveSide to match calibratedSide
            appleVisionActiveSide = calibratedSide;
          }
        }
        // If confidence insufficient, side remains null (grace period will handle this)
        // V1.8.5: DO NOT fall back to other side
      } else {
        // FRONT or not calibrated: use getBestConfidentSide for dynamic selection
        side = getBestConfidentSide(frame, minConfidence);
      }

      if (side) {
        lastValidArmTimestampMs = frame.timestampMs;
        invalidStartTimestampMs = null;
      }

      // Check for grace timeout
      if (!side && lastValidArmTimestampMs !== null && invalidStartTimestampMs === null) {
        invalidStartTimestampMs = frame.timestampMs;
      }

      if (!side && invalidStartTimestampMs !== null) {
        const invalidDuration = frame.timestampMs - invalidStartTimestampMs;

        if (invalidDuration < invalidThreshold) {
          // Within grace period - preserve state
          return currentResult(false);
        }

        // Grace period exceeded - reset but keep count
        clearCalibration();
        clearCountingState();
        return currentResult(false);
      }

      if (!side) {
        clearCalibration();
        clearCountingState();
        return currentResult(false);
      }

      // ===== CALIBRATION LOGIC =====
      if (calibrationMode === null) {
        // V1.8.2: STANDING HARD GATE - Before calibration, check if clearly standing
        // If standing, immediately reject this frame from calibration
        if (isClearlyStandingPose(byName, frame)) {
          // Clear any pending calibration progress
          calibrationCandidate = null;
          calibrationCandidateSide = null;
          calibrationFrames = 0;
          calibrationMissFrames = 0;
          return currentResult(false);
        }

        // Not calibrated yet - try to calibrate
        const frontCandidate = checkFrontCalibration(byName);
        const sideCandidate = checkSideCalibration(byName);

        if (frontCandidate || sideCandidate) {
          const candidate: CalibrationMode = frontCandidate ? 'front' : 'side';

          if (candidate === calibrationCandidate) {
            // Same candidate mode
            // V1.8.2: For SIDE, check if side changed
            if (candidate === 'side') {
              const currentSide = sideCandidate; // 'left' or 'right'
              if (calibrationCandidateSide !== currentSide) {
                // Side changed - reset calibration
                calibrationCandidateSide = currentSide;
                calibrationFrames = 1;
                calibrationMissFrames = 0;
              } else {
                // Same side - increment
                calibrationFrames++;
                calibrationMissFrames = 0;
              }
            } else {
              // FRONT - same as before
              calibrationFrames++;
              calibrationMissFrames = 0;
            }

            if (calibrationFrames >= CALIBRATION_MIN_STABLE_FRAMES) {
              // Calibration successful!
              calibrationMode = candidate;
              phase = 'ready';

              // V1.8.3: For SIDE, use the side that actually passed SIDE calibration
              // V1.8.4: Lock this side for the duration of SIDE calibration
              if (candidate === 'side' && sideCandidate !== null) {
                calibratedSide = sideCandidate;
                appleVisionActiveSide = sideCandidate;
              } else {
                // FRONT: clear calibratedSide
                calibratedSide = null;
              }

              // V1.8.3: Establish baseline from the correct side
              const baselineArm = (candidate === 'side' && sideCandidate !== null)
                ? getSideLandmarks(frame, sideCandidate)
                : side;

              if (baselineArm) {
                lastElbowAngle = calculateAngle(baselineArm.shoulder, baselineArm.elbow, baselineArm.wrist);
                appleVisionUpBaselineAngle = lastElbowAngle;
                // V1.8.5: Set baseline side correctly
                appleVisionUpBaselineSide = (candidate === 'side' && sideCandidate !== null)
                  ? sideCandidate
                  : side.side;
              }

              return currentResult(true);
            }
          } else {
            // New candidate or changed candidate - reset
            calibrationCandidate = candidate;
            calibrationCandidateSide = candidate === 'side' ? sideCandidate : null;
            calibrationFrames = 1;
            calibrationMissFrames = 0;
          }
        } else {
          // Not a valid calibration frame - apply 1-frame miss tolerance
          if (calibrationCandidate !== null && calibrationMissFrames < 1) {
            // Allow 1 miss frame
            calibrationMissFrames++;
            // Keep calibrationCandidate, calibrationCandidateSide, and calibrationFrames
          } else {
            // Clear calibration state
            calibrationCandidate = null;
            calibrationCandidateSide = null;
            calibrationFrames = 0;
            calibrationMissFrames = 0;
          }
        }

        // Still calibrating - don't count yet
        lastElbowAngle = calculateAngle(side.shoulder, side.elbow, side.wrist);
        return currentResult(false);
      }

      // ===== CALIBRATED - NORMAL COUNTING LOGIC =====
      // V1.8.4: For SIDE, side is already from calibratedSide
      // For FRONT, side is from getBestConfidentSide
      // Calculate elbow angle
      lastElbowAngle = calculateAngle(side.shoulder, side.elbow, side.wrist);

      // Classify pose
      let observedPose: 'up' | 'down' | null;
      if (isAV) {
        observedPose = classifyElbowPoseForAppleVision(lastElbowAngle, downAngle, upAngle, side.side);

        // V1.8.5.1: Track UP baseline with side, allowing FRONT side-switch to establish new baseline
        if (observedPose === 'up') {
          if (appleVisionUpBaselineAngle === null || appleVisionUpBaselineSide === null) {
            // Case A: No baseline yet - establish baseline
            appleVisionUpBaselineAngle = lastElbowAngle;
            appleVisionUpBaselineSide = side.side;
          } else if (appleVisionUpBaselineSide === side.side) {
            // Case B: Same side as baseline - anti-drift (Math.max)
            appleVisionUpBaselineAngle = Math.max(appleVisionUpBaselineAngle, lastElbowAngle);
          } else {
            // Case C: Different side - FRONT dynamic side-switch detected
            // V1.8.5.1: Only establish new baseline if we are at FULL UP (angle >= upAngle)
            // This is already guaranteed because observedPose === 'up'
            appleVisionUpBaselineAngle = lastElbowAngle;
            appleVisionUpBaselineSide = side.side;
          }
        }
      } else {
        observedPose = classifyElbowPose(lastElbowAngle, downAngle, upAngle);
      }

      if (!observedPose) {
        candidatePose = null;
        candidateFrames = 0;
        return currentResult(true);
      }

      if (candidatePose === observedPose) {
        candidateFrames += 1;
      } else {
        candidatePose = observedPose;
        candidateFrames = 1;
      }

      if (candidateFrames < minStableFrames) {
        return currentResult(true);
      }

      if (observedPose === 'up') {
        if (phase === 'down') {
          count += 1;
        }
        phase = 'ready';
        return currentResult(true);
      }

      if (phase === 'ready' && observedPose === 'down') {
        phase = 'down';
        // V1.8.5: Clear both baseline angle and side
        appleVisionUpBaselineAngle = null;
        appleVisionUpBaselineSide = null;
      }

      return currentResult(true);
    },

    reset(): PushUpCounterResult {
      count = 0;
      clearCalibration();
      clearCountingState();
      return currentResult(false);
    },

    resetTrackingStatePreservingCount(): PushUpCounterResult {
      clearCalibration();
      clearCountingState();
      return currentResult(false);
    },
  };
}

/**
 * Squat counter with Apple Vision relaxed rules.
 * (Unchanged from V1.7.1)
 */
export function createSquatCounter(options: SquatCounterOptions = {}): PushUpCounter {
  const targetCount = normalizeTargetCount(options.targetCount);

  const configuredMinConfidence = options.minConfidence;
  const configuredStableFrames = Math.max(
    1,
    Math.trunc(options.minStableFrames ?? DEFAULT_MIN_STABLE_FRAMES),
  );

  type Phase = 'waiting_for_body' | 'standing_ready' | 'down_confirmed';

  let count = 0;
  let phase: Phase = 'waiting_for_body';
  let lastKneeAngle: number | null = null;
  let currentPose: 'standing' | 'squatting' | null = null;
  let currentPoseFrames = 0;

  let baselineHipYSamples: number[] = [];
  let baselineScaleSamples: number[] = [];

  let transitionStartTime: number | null = null;
  let invalidStartTimestampMs: number | null = null;

  function isAppleVision(frame: PoseFrame): boolean {
    return frame.source === 'apple-vision';
  }

  function getMinStableFrames(frame: PoseFrame): number {
    if (isAppleVision(frame)) {
      return Math.max(APPLE_VISION_SQUAT_MIN_STABLE_FRAMES, configuredStableFrames);
    }
    return Math.max(SQUAT_MIN_STABLE_FRAMES, configuredStableFrames);
  }

  function getInvalidThreshold(frame: PoseFrame): number {
    return isAppleVision(frame) ? APPLE_VISION_INVALID_DURATION_THRESHOLD_MS : INVALID_DURATION_THRESHOLD_MS;
  }

  function getTransitionThreshold(frame: PoseFrame): number {
    return isAppleVision(frame) ? APPLE_VISION_MAX_TRANSITION_DURATION_MS : MAX_TRANSITION_DURATION_MS;
  }

  function getBaselineHipY(): number | null {
    if (baselineHipYSamples.length === 0) return null;
    return baselineHipYSamples.reduce((a, b) => a + b, 0) / baselineHipYSamples.length;
  }

  function getBaselineScale(): number | null {
    if (baselineScaleSamples.length === 0) return null;
    return baselineScaleSamples.reduce((a, b) => a + b, 0) / baselineScaleSamples.length;
  }

  function updateBaseline(midHipY: number, poseScale: number): void {
    baselineHipYSamples.push(midHipY);
    baselineScaleSamples.push(poseScale);
    if (baselineHipYSamples.length > BASELINE_SAMPLE_COUNT) baselineHipYSamples.shift();
    if (baselineScaleSamples.length > BASELINE_SAMPLE_COUNT) baselineScaleSamples.shift();
  }

  function clearBaseline(): void {
    baselineHipYSamples = [];
    baselineScaleSamples = [];
  }

  function currentResult(isPoseReady: boolean): PushUpCounterResult {
    return {
      count,
      phase: phase === 'waiting_for_body' ? 'waiting_for_body'
        : phase === 'standing_ready' ? 'ready'
        : 'down',
      isPoseReady,
      isComplete: count >= targetCount,
      elbowAngle: lastKneeAngle,
    };
  }

  function classifyFrame(frame: PoseFrame): SquatPoseClassification {
    const baselineHipY = getBaselineHipY();
    const baselineScale = getBaselineScale();

    const classifierOptions: { minConfidence?: number; standingBaselineHipY?: number; standingBaselineScale?: number } = {
      standingBaselineHipY: baselineHipY ?? undefined,
      standingBaselineScale: baselineScale ?? undefined,
    };

    if (configuredMinConfidence !== undefined) {
      classifierOptions.minConfidence = configuredMinConfidence;
    }

    return classifySquatPoseFrame(frame, classifierOptions);
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      const classification = classifyFrame(frame);

      lastKneeAngle = classification.metrics?.averageKneeAngle ?? null;

      const invalidThreshold = getInvalidThreshold(frame);
      const transitionThreshold = getTransitionThreshold(frame);
      const minStableFrames = getMinStableFrames(frame);

      if (classification.qualityIssue !== 'ok') {
        if (invalidStartTimestampMs === null) {
          invalidStartTimestampMs = frame.timestampMs;
        }

        const invalidDuration = frame.timestampMs - invalidStartTimestampMs;
        if (phase === 'waiting_for_body' || invalidDuration >= invalidThreshold) {
          phase = 'waiting_for_body';
          currentPose = null;
          currentPoseFrames = 0;
          invalidStartTimestampMs = null;
          transitionStartTime = null;
          clearBaseline();
        }
        return currentResult(false);
      }

      invalidStartTimestampMs = null;

      if (classification.label === 'unknown') {
        if (transitionStartTime === null) {
          transitionStartTime = frame.timestampMs;
        }

        const transitionElapsed = frame.timestampMs - transitionStartTime;
        if (transitionElapsed > transitionThreshold) {
          phase = 'waiting_for_body';
          currentPose = null;
          currentPoseFrames = 0;
          transitionStartTime = null;
          clearBaseline();
          return currentResult(false);
        }

        return currentResult(true);
      }

      transitionStartTime = null;

      if (classification.label === 'standing' && classification.metrics) {
        updateBaseline(classification.metrics.midHipY, classification.metrics.poseScale);
      }

      if (phase === 'waiting_for_body') {
        if (classification.label === 'standing') {
          if (currentPose === 'standing') {
            currentPoseFrames += 1;
          } else {
            currentPose = 'standing';
            currentPoseFrames = 1;
          }

          if (baselineHipYSamples.length >= BASELINE_SAMPLE_COUNT && baselineScaleSamples.length >= BASELINE_SAMPLE_COUNT && currentPoseFrames >= minStableFrames) {
            phase = 'standing_ready';
            currentPose = null;
            currentPoseFrames = 0;
          }
        }
        return currentResult(true);
      }

      const observedPose: 'standing' | 'squatting' =
        classification.label === 'squatting' ? 'squatting' : 'standing';

      if (currentPose === observedPose) {
        currentPoseFrames += 1;
      } else {
        currentPose = observedPose;
        currentPoseFrames = 1;
      }

      if (currentPoseFrames < minStableFrames) {
        return currentResult(true);
      }

      if (isAppleVision(frame)) {
        if (phase === 'standing_ready' && observedPose === 'squatting') {
          count += 1;
          phase = 'down_confirmed';
          return currentResult(true);
        }

        if (phase === 'down_confirmed' && observedPose === 'standing') {
          phase = 'standing_ready';
          return currentResult(true);
        }
      } else {
        if (phase === 'standing_ready' && observedPose === 'squatting') {
          phase = 'down_confirmed';
          return currentResult(true);
        }

        if (phase === 'down_confirmed' && observedPose === 'standing') {
          count += 1;
          phase = 'standing_ready';
          return currentResult(true);
        }
      }

      return currentResult(true);
    },

    reset(): PushUpCounterResult {
      count = 0;
      phase = 'waiting_for_body';
      lastKneeAngle = null;
      currentPose = null;
      currentPoseFrames = 0;
      invalidStartTimestampMs = null;
      transitionStartTime = null;
      clearBaseline();
      return currentResult(false);
    },

    resetTrackingStatePreservingCount(): PushUpCounterResult {
      phase = 'waiting_for_body';
      lastKneeAngle = null;
      currentPose = null;
      currentPoseFrames = 0;
      invalidStartTimestampMs = null;
      transitionStartTime = null;
      clearBaseline();
      return currentResult(false);
    },
  };
}
