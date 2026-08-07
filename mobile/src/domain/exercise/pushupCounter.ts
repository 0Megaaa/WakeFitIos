import { classifySquatPoseFrame, THRESHOLDS, type SquatPoseClassification } from './squatPoseClassifier.ts';
import { normalizeTargetCount } from '../alarm/alarm.ts';
import type {
  PoseFrame,
  PushUpPhase,
  PushUpCounter,
  PushUpCounterOptions,
  PushUpCounterResult,
  SquatCounterOptions,
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
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const downAngle = options.downAngle ?? 90;
  const upAngle = options.upAngle ?? 160;
  const minStableFrames = Math.max(1, Math.trunc(options.minStableFrames ?? DEFAULT_MIN_STABLE_FRAMES));

  let count = 0;
  let phase: PushUpPhase = 'waiting_for_body';
  let lastElbowAngle: number | null = null;
  let candidatePose: 'up' | 'down' | null = null;
  let candidateFrames = 0;

  function currentResult(isPoseReady: boolean): PushUpCounterResult {
    return {
      count,
      phase,
      isPoseReady,
      isComplete: count >= targetCount,
      elbowAngle: lastElbowAngle,
    };
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      const side = getBestConfidentSide(frame, minConfidence);
      if (!side) {
        phase = 'waiting_for_body';
        lastElbowAngle = null;
        candidatePose = null;
        candidateFrames = 0;
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
    },

    reset(): PushUpCounterResult {
      count = 0;
      phase = 'waiting_for_body';
      lastElbowAngle = null;
      candidatePose = null;
      candidateFrames = 0;
      return currentResult(false);
    },

    resetTrackingStatePreservingCount(): PushUpCounterResult {
      phase = 'waiting_for_body';
      lastElbowAngle = null;
      candidatePose = null;
      candidateFrames = 0;
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
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

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

  function getMinStableFrames(frame: PoseFrame): number {
    return isAppleVision(frame) ? APPLE_VISION_SQUAT_MIN_STABLE_FRAMES : SQUAT_MIN_STABLE_FRAMES;
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
   * Returns classification with all details.
   */
  function classifyFrame(frame: PoseFrame): SquatPoseClassification {
    const baselineHipY = getBaselineHipY();
    const baselineScale = getBaselineScale();

    return classifySquatPoseFrame(frame, {
      minConfidence,
      standingBaselineHipY: baselineHipY ?? undefined,
      standingBaselineScale: baselineScale ?? undefined,
    });
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

type RequiredSide = {
  shoulder: { x: number; y: number; confidence: number };
  elbow: { x: number; y: number; confidence: number };
  wrist: { x: number; y: number; confidence: number };
  hip: { x: number; y: number; confidence: number };
};

function getBestConfidentSide(frame: PoseFrame, minConfidence: number): RequiredSide | null {
  const left = getConfidentSide(frame, 'left', minConfidence);
  const right = getConfidentSide(frame, 'right', minConfidence);
  if (!left) return right;
  if (!right) return left;
  return averageConfidence(right) > averageConfidence(left) ? right : left;
}

function getConfidentSide(frame: PoseFrame, side: string, minConfidence: number): RequiredSide | null {
  const byName = new Map<string, { x: number; y: number; confidence: number }>();
  for (const item of frame.landmarks) {
    byName.set(item.name, item);
  }
  const shoulder = byName.get(`${side}Shoulder`);
  const elbow = byName.get(`${side}Elbow`);
  const wrist = byName.get(`${side}Wrist`);
  const hip = byName.get(`${side}Hip`);
  if (!shoulder || !elbow || !wrist || !hip) return null;
  if (shoulder.confidence < minConfidence || elbow.confidence < minConfidence || wrist.confidence < minConfidence || hip.confidence < minConfidence) return null;
  return { shoulder, elbow, wrist, hip };
}

function averageConfidence(side: RequiredSide): number {
  return (side.shoulder.confidence + side.elbow.confidence + side.wrist.confidence + side.hip.confidence) / 4;
}

function classifyElbowPose(angle: number, downAngle: number, upAngle: number): 'up' | 'down' | null {
  if (angle >= upAngle) return 'up';
  if (angle < downAngle) return 'down';
  return null;
}
