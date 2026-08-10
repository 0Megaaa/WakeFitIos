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

  let count = 0;
  let phase: PushUpPhase = 'waiting_for_body';
  let lastElbowAngle: number | null = null;
  let candidatePose: 'up' | 'down' | null = null;
  let candidateFrames = 0;

  // Apple Vision specific state
  let appleVisionUpBaselineAngle: number | null = null;
  let appleVisionActiveSide: 'left' | 'right' | null = null;

  // Grace timeout for temporary arm loss
  let lastValidArmTimestampMs: number | null = null;
  let invalidStartTimestampMs: number | null = null;

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
   * Check if this side has sufficient arm chain for Apple Vision push-up.
   * Apple Vision only requires shoulder + elbow + wrist (no hip required).
   *
   * For ML Kit, we still require hip for backward compatibility.
   */
  function hasValidArmSide(
    frame: PoseFrame,
    side: 'left' | 'right',
    minConfidence: number,
  ): boolean {
    const byName = new Map<string, { x: number; y: number; confidence: number }>();
    for (const item of frame.landmarks) {
      byName.set(item.name, item);
    }

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
   * Get the best confident arm side for the frame.
   *
   * Stabilization strategy:
   * - Once a rep tracking has started, prefer the current active side
   * - Only switch when the active side becomes unreliable
   * - This prevents rapid side switching due to confidence fluctuations
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
        // Active side is still valid, use it
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
    const byName = new Map<string, { x: number; y: number; confidence: number }>();
    for (const item of frame.landmarks) {
      byName.set(item.name, item);
    }

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
    const byName = new Map<string, { x: number; y: number; confidence: number }>();
    for (const item of frame.landmarks) {
      byName.set(item.name, item);
    }

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
   *
   * Apple Vision push-up DOWN classification:
   * 1. absoluteDown: elbowAngle <= absoluteDownAngle (e.g., 135°)
   * 2. relativeDown: (baselineAngle - elbowAngle) >= relativeDelta (e.g., 25°)
   *                  AND elbowAngle <= relativeMaxAngle (e.g., 145°)
   *
   * This supports front-facing camera where 2D projection may not show
   * as dramatic angle reduction as side view.
   */
  function classifyElbowPoseForAppleVision(
    angle: number,
    absoluteDownAngle: number,
    upAngle: number,
  ): 'up' | 'down' | null {
    // First check if clearly UP
    if (angle >= upAngle) {
      return 'up';
    }

    // Check absolute DOWN
    if (angle <= absoluteDownAngle) {
      return 'down';
    }

    // Check relative DOWN fallback for Apple Vision
    // Only applies when we have a valid baseline
    if (appleVisionUpBaselineAngle !== null) {
      const delta = appleVisionUpBaselineAngle - angle;
      if (delta >= APPLE_VISION_RELATIVE_DOWN_DELTA && angle <= APPLE_VISION_RELATIVE_DOWN_MAX_ANGLE) {
        return 'down';
      }
    }

    // In transition zone - neither up nor down
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

      // Track last valid arm timestamp for grace timeout
      const side = getBestConfidentSide(frame, minConfidence);

      if (side) {
        lastValidArmTimestampMs = frame.timestampMs;
        invalidStartTimestampMs = null;
      }

      // Check for grace timeout - temporary arm loss
      // Apple Vision ONLY: ML Kit should reset immediately on no valid arm
      if (!side && isAV && lastValidArmTimestampMs !== null && invalidStartTimestampMs === null) {
        invalidStartTimestampMs = frame.timestampMs;
      }

      // Handle grace timeout
      if (!side && invalidStartTimestampMs !== null) {
        const invalidDuration = frame.timestampMs - invalidStartTimestampMs;

        // Apple Vision ONLY: Within grace period, preserve state but mark not ready
        if (isAV && invalidDuration < invalidThreshold) {
          // Keep current phase and count, but don't update state
          // This allows temporary arm loss without resetting
          return currentResult(false);
        }

        // Grace period exceeded (Apple Vision) OR immediate reset (ML Kit)
        phase = 'waiting_for_body';
        lastElbowAngle = null;
        candidatePose = null;
        candidateFrames = 0;
        appleVisionUpBaselineAngle = null;
        appleVisionActiveSide = null;
        invalidStartTimestampMs = null;
        lastValidArmTimestampMs = null;
        return currentResult(false);
      }

      if (!side) {
        // No valid arm side detected
        phase = 'waiting_for_body';
        lastElbowAngle = null;
        candidatePose = null;
        candidateFrames = 0;
        appleVisionUpBaselineAngle = null;
        appleVisionActiveSide = null;
        return currentResult(false);
      }

      // Calculate elbow angle
      lastElbowAngle = calculateAngle(side.shoulder, side.elbow, side.wrist);

      // Classify pose based on source
      let observedPose: 'up' | 'down' | null;
      let isRelativeDownFallback = false;
      if (isAV) {
        observedPose = classifyElbowPoseForAppleVision(lastElbowAngle, downAngle, upAngle);
        isRelativeDownFallback = observedPose === 'down' && lastElbowAngle > downAngle;

        // Track UP baseline for relative fallback
        // Use Math.max to prevent baseline drift downward
        // Once user has shown a straight arm (e.g., 172°), lower readings
        // from vision noise won't drag the baseline down
        if (observedPose === 'up') {
          if (appleVisionUpBaselineAngle === null) {
            appleVisionUpBaselineAngle = lastElbowAngle;
          } else {
            // Only update if current angle is higher (more extended)
            // This prevents baseline from drifting down due to vision noise
            appleVisionUpBaselineAngle = Math.max(appleVisionUpBaselineAngle, lastElbowAngle);
          }
        }
        // Note: We only reset baseline when:
        // 1. Detected absolute DOWN (angle <= downAngle), OR
        // 2. State machine confirms DOWN state (after stable frames)
        // We do NOT reset on relative down detection alone, as it needs confirmation
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
        // Reset baseline when DOWN is confirmed - we'll establish new baseline when up again
        appleVisionUpBaselineAngle = null;
      }

      return currentResult(true);
    },

    reset(): PushUpCounterResult {
      count = 0;
      phase = 'waiting_for_body';
      lastElbowAngle = null;
      candidatePose = null;
      candidateFrames = 0;
      appleVisionUpBaselineAngle = null;
      appleVisionActiveSide = null;
      invalidStartTimestampMs = null;
      lastValidArmTimestampMs = null;
      return currentResult(false);
    },

    resetTrackingStatePreservingCount(): PushUpCounterResult {
      phase = 'waiting_for_body';
      lastElbowAngle = null;
      candidatePose = null;
      candidateFrames = 0;
      appleVisionUpBaselineAngle = null;
      appleVisionActiveSide = null;
      invalidStartTimestampMs = null;
      lastValidArmTimestampMs = null;
      return currentResult(false);
    },
  };
}

/**
 * Squat counter with Apple Vision relaxed rules.
 *
 * State machine:
 * 1. waiting_for_body: waiting for person to appear
 * 2. standing_ready: person is standing, baseline established (3+ samples)
 * 3. down_confirmed: squat counted, waiting for re-standing to unlock next count
 *
 * Counting rule (iOS Apple Vision relaxed):
 * - standing_ready -> squatting detected -> count + 1 immediately -> down_confirmed
 * - down_confirmed -> standing -> standing_ready (unlocks next count, no +1)
 *
 * Key differences from ML Kit:
 * - Count on squat (not after full cycle)
 * - Relaxed confidence (0.35 vs 0.55)
 * - Relaxed invalid timeout (1500ms vs 700ms)
 * - Relaxed transition timeout (3500ms vs 2000ms)
 * - Relaxed stable frame requirement (2 vs 3)
 * - Apple Vision relaxed fallback for squat detection
 *
 * Frame classification:
 * - invalid: qualityIssue != 'ok' -> increases invalidFrameCount, may clear baseline
 * - standing: qualityIssue == 'ok' && label == 'standing' -> updates baseline
 * - squatting: qualityIssue == 'ok' && label == 'squatting' -> counts squat
 * - transition: qualityIssue == 'ok' && label == 'unknown' -> time-based timeout
 */
export function createSquatCounter(options: SquatCounterOptions = {}): PushUpCounter {
  const targetCount = normalizeTargetCount(options.targetCount);

  // Store explicit config for stable frames
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

  // Standing baseline tracking - requires minimum 3 samples
  let baselineHipYSamples: number[] = [];
  let baselineScaleSamples: number[] = [];

  // Transition tracking with time-based timeout
  let transitionStartTime: number | null = null;

  // Invalid frame time gate (instead of fixed 3-frame counter)
  let invalidStartTimestampMs: number | null = null;

  function isAppleVision(frame: PoseFrame): boolean {
    return frame.source === 'apple-vision';
  }

  /**
   * Get minimum stable frames for squat detection.
   * Uses source-specific defaults but respects explicit configuration.
   */
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

  /**
   * Classify frame using the squat classifier.
   * Only passes explicit minConfidence if configured; otherwise classifier uses source-specific default.
   */
  function classifyFrame(frame: PoseFrame): SquatPoseClassification {
    const baselineHipY = getBaselineHipY();
    const baselineScale = getBaselineScale();

    // Only pass minConfidence if explicitly configured
    // Otherwise, classifier will use source-specific default (0.35 for Apple Vision, 0.55 for ML Kit)
    const classifierOptions: { minConfidence?: number; standingBaselineHipY?: number; standingBaselineScale?: number } = {
      standingBaselineHipY: baselineHipY ?? undefined,
      standingBaselineScale: baselineScale ?? undefined,
    };

    // Only override default if user explicitly configured minConfidence
    if (configuredMinConfidence !== undefined) {
      classifierOptions.minConfidence = configuredMinConfidence;
    }

    return classifySquatPoseFrame(frame, classifierOptions);
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      // Classify the frame using the classifier
      const classification = classifyFrame(frame);

      lastKneeAngle = classification.metrics?.averageKneeAngle ?? null;

      // Get source-specific thresholds
      const invalidThreshold = getInvalidThreshold(frame);
      const transitionThreshold = getTransitionThreshold(frame);
      const minStableFrames = getMinStableFrames(frame);

      // Handle invalid frames (qualityIssue != 'ok')
      if (classification.qualityIssue !== 'ok') {
        if (invalidStartTimestampMs === null) {
          invalidStartTimestampMs = frame.timestampMs;
        }

        // If too long in invalid state, reset to waiting
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

      // Reset invalid tracking when we get a valid frame
      invalidStartTimestampMs = null;

      // Handle transition frames (qualityIssue == 'ok' && label == 'unknown')
      if (classification.label === 'unknown') {
        // Start tracking transition time if not already
        if (transitionStartTime === null) {
          transitionStartTime = frame.timestampMs;
        }

        // Check if transition timeout exceeded
        const transitionElapsed = frame.timestampMs - transitionStartTime;
        if (transitionElapsed > transitionThreshold) {
          // Transition taking too long - likely not a valid squat sequence
          phase = 'waiting_for_body';
          currentPose = null;
          currentPoseFrames = 0;
          transitionStartTime = null;
          clearBaseline();
          return currentResult(false);
        }

        // Transition frames don't change state but maintain current phase
        return currentResult(true);
      }

      // Valid classification (standing or squatting)
      // Clear transition tracking
      transitionStartTime = null;

      // Update baseline with standing frames
      if (classification.label === 'standing' && classification.metrics) {
        updateBaseline(classification.metrics.midHipY, classification.metrics.poseScale);
      }

      // waiting_for_body: look for standing to establish baseline
      if (phase === 'waiting_for_body') {
        if (classification.label === 'standing') {
          // Keep tracking standing until we have enough samples
          if (currentPose === 'standing') {
            currentPoseFrames += 1;
          } else {
            currentPose = 'standing';
            currentPoseFrames = 1;
          }

          // Move to standing_ready when we have minimum baseline samples
          if (baselineHipYSamples.length >= BASELINE_SAMPLE_COUNT && baselineScaleSamples.length >= BASELINE_SAMPLE_COUNT && currentPoseFrames >= minStableFrames) {
            phase = 'standing_ready';
            currentPose = null;
            currentPoseFrames = 0;
          }
        }
        return currentResult(true);
      }

      // standing_ready or down_confirmed
      // Use ONLY classifier's label for squatting determination
      const observedPose: 'standing' | 'squatting' =
        classification.label === 'squatting' ? 'squatting' : 'standing';

      // Track pose consistency
      if (currentPose === observedPose) {
        currentPoseFrames += 1;
      } else {
        currentPose = observedPose;
        currentPoseFrames = 1;
      }

      // Need stable frames before transitioning
      if (currentPoseFrames < minStableFrames) {
        return currentResult(true);
      }

      // ===== COUNTING LOGIC =====
      // Apple Vision: count +1 on squat, unlock on standing
      // ML Kit: count +1 only after full standing → squat → standing cycle

      if (isAppleVision(frame)) {
        // Apple Vision relaxed: count on squat immediately
        // standing_ready -> squatting: count + 1 immediately
        if (phase === 'standing_ready' && observedPose === 'squatting') {
          count += 1;
          phase = 'down_confirmed';
          return currentResult(true);
        }

        // down_confirmed -> standing: unlock next count (no +1)
        if (phase === 'down_confirmed' && observedPose === 'standing') {
          phase = 'standing_ready';
          return currentResult(true);
        }
      } else {
        // ML Kit: count only after full standing → squat → standing cycle
        // standing_ready -> squatting: just go to down_confirmed (no count)
        if (phase === 'standing_ready' && observedPose === 'squatting') {
          phase = 'down_confirmed';
          return currentResult(true);
        }

        // down_confirmed -> standing: count + 1 and go back to ready
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
