import { classifySquatPoseFrame, THRESHOLDS, type SquatPoseClassification } from './squatPoseClassifier.ts';
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
const SQUAT_MAX_MISSED_FRAMES = 3;
const BASELINE_SAMPLE_COUNT = 3;

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
  const targetCount = options.targetCount ?? DEFAULT_TARGET_COUNT;
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
 * Squat counter with real standing baseline tracking.
 *
 * State machine:
 * 1. waiting_for_body: waiting for person to appear
 * 2. standing_ready: person is standing, baseline established
 * 3. down_confirmed: person has gone down (squat detected)
 *
 * A squat is counted when: standing_ready -> down_confirmed -> standing_ready
 */
export function createSquatCounter(options: SquatCounterOptions = {}): PushUpCounter {
  const targetCount = options.targetCount ?? DEFAULT_TARGET_COUNT;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minStableFrames = Math.max(2, Math.trunc(options.minStableFrames ?? DEFAULT_MIN_STABLE_FRAMES));

  type Phase = 'waiting_for_body' | 'standing_ready' | 'down_confirmed';

  let count = 0;
  let phase: Phase = 'waiting_for_body';
  let lastKneeAngle: number | null = null;
  let currentPose: 'standing' | 'squatting' | null = null;
  let currentPoseFrames = 0;
  let missedFrames = 0;

  // Standing baseline tracking - rolling average of recent standing frames
  let baselineHipYSamples: number[] = [];
  let baselineScaleSamples: number[] = [];

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

  function classifyPose(frame: PoseFrame, baselineHipY: number | null, baselineScale: number | null): {
    label: 'standing' | 'squatting' | 'unknown';
    metrics: { midHipY: number; poseScale: number; averageKneeAngle: number } | null;
  } {
    const result = classifySquatPoseFrame(frame, {
      minConfidence,
      standingBaselineHipY: baselineHipY ?? undefined,
      standingBaselineScale: baselineScale ?? undefined,
    });

    return {
      label: result.label,
      metrics: result.metrics ? {
        midHipY: result.metrics.midHipY,
        poseScale: result.metrics.poseScale,
        averageKneeAngle: result.metrics.averageKneeAngle,
      } : null,
    };
  }

  function detectSquatWithBaseline(frame: PoseFrame, baselineHipY: number, baselineScale: number): boolean {
    const result = classifySquatPoseFrame(frame, {
      minConfidence,
      standingBaselineHipY: baselineHipY,
      standingBaselineScale: baselineScale,
    });

    // Check if squat conditions are met
    if (result.metrics && result.qualityIssue === 'ok') {
      const { midHipY, poseScale, averageKneeAngle, hipDropRatio, scaleChangeRatio } = result.metrics;

      // Must have significant hip drop
      if (hipDropRatio >= THRESHOLDS.MIN_HIP_DROP_RATIO &&
          // Must not have excessive scale change (camera movement)
          scaleChangeRatio <= THRESHOLDS.MAX_SCALE_CHANGE_RATIO &&
          // Must have clear knee bend
          averageKneeAngle <= THRESHOLDS.KNEE_DOWN_PARTIAL) {
        return true;
      }
    }
    return false;
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      // Classify the frame
      const baselineHipY = getBaselineHipY();
      const baselineScale = getBaselineScale();
      const result = classifyPose(frame, baselineHipY, baselineScale);

      lastKneeAngle = result.metrics?.averageKneeAngle ?? null;

      if (result.label === 'unknown' || !result.metrics) {
        // Poor quality frame
        missedFrames += 1;
        if (phase === 'waiting_for_body' || missedFrames > SQUAT_MAX_MISSED_FRAMES) {
          phase = 'waiting_for_body';
          currentPose = null;
          currentPoseFrames = 0;
          baselineHipYSamples = [];
          baselineScaleSamples = [];
        }
        return currentResult(false);
      }

      missedFrames = 0;
      const { midHipY, poseScale } = result.metrics;

      // Update baseline with standing frames
      if (result.label === 'standing') {
        updateBaseline(midHipY, poseScale);
      }

      // waiting_for_body: look for standing to establish baseline
      if (phase === 'waiting_for_body') {
        if (result.label === 'standing') {
          // Keep tracking standing until we have enough samples
          if (currentPose === 'standing') {
            currentPoseFrames += 1;
          } else {
            currentPose = 'standing';
            currentPoseFrames = 1;
          }

          // Move to standing_ready when we have baseline samples
          if (baselineHipYSamples.length >= 2) {
            phase = 'standing_ready';
            currentPose = null;
            currentPoseFrames = 0;
          }
        }
        return currentResult(true);
      }

      // standing_ready or down_confirmed
      // First check if this is squatting using baseline
      const isSquatting = baselineHipY !== null && baselineScale !== null
        && detectSquatWithBaseline(frame, baselineHipY, baselineScale);

      const detectedPose: 'standing' | 'squatting' = isSquatting ? 'squatting' : 'standing';

      // Track pose consistency
      if (currentPose === detectedPose) {
        currentPoseFrames += 1;
      } else {
        currentPose = detectedPose;
        currentPoseFrames = 1;
      }

      // Need stable frames before transitioning
      if (currentPoseFrames < minStableFrames) {
        return currentResult(true);
      }

      // standing_ready -> down_confirmed
      if (phase === 'standing_ready' && detectedPose === 'squatting') {
        phase = 'down_confirmed';
        return currentResult(true);
      }

      // down_confirmed -> standing_ready, count += 1
      if (phase === 'down_confirmed' && detectedPose === 'standing') {
        count += 1;
        phase = 'standing_ready';
        return currentResult(true);
      }

      return currentResult(true);
    },

    reset(): PushUpCounterResult {
      count = 0;
      phase = 'waiting_for_body';
      lastKneeAngle = null;
      currentPose = null;
      currentPoseFrames = 0;
      missedFrames = 0;
      baselineHipYSamples = [];
      baselineScaleSamples = [];
      return currentResult(false);
    },

    resetTrackingStatePreservingCount(): PushUpCounterResult {
      phase = 'waiting_for_body';
      lastKneeAngle = null;
      currentPose = null;
      currentPoseFrames = 0;
      missedFrames = 0;
      baselineHipYSamples = [];
      baselineScaleSamples = [];
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
