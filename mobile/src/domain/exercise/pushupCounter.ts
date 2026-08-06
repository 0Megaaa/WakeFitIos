import { classifySquatPoseFrame, type SquatPoseClassification } from './squatPoseClassifier.ts';
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
  };
}

/**
 * Squat counter state machine.
 *
 * Count rule: a full cycle of STANDING → SQUATTING → STANDING must complete
 * before a squat is counted.
 *
 * State transitions:
 * waiting_for_body → (2+ stable standing frames) → standing_ready
 * standing_ready → (2+ stable squatting frames) → down_confirmed
 * down_confirmed → (2+ stable standing frames) → standing_ready, count += 1
 *
 * Short gaps (1-3 lost frames) keep current state.
 * Long gaps reset to waiting_for_body.
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

  function toObservedPose(classification: SquatPoseClassification): 'standing' | 'squatting' | null {
    if (classification.label === 'unknown') {
      return null;
    }
    if (classification.label === 'standing') {
      return 'standing';
    }
    if (classification.label === 'squatting') {
      return 'squatting';
    }
    return null;
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      const classification = classifySquatPoseFrame(frame, { minConfidence });
      lastKneeAngle = classification.metrics?.averageKneeAngle ?? null;

      if (classification.qualityIssue !== 'ok') {
        missedFrames += 1;
        if (phase === 'waiting_for_body' || missedFrames > SQUAT_MAX_MISSED_FRAMES) {
          phase = 'waiting_for_body';
          currentPose = null;
          currentPoseFrames = 0;
        }
        return currentResult(false);
      }

      missedFrames = 0;
      const observedPose = toObservedPose(classification);

      if (!observedPose) {
        currentPose = null;
        currentPoseFrames = 0;
        return currentResult(true);
      }

      if (currentPose === observedPose) {
        currentPoseFrames += 1;
      } else {
        currentPose = observedPose;
        currentPoseFrames = 1;
      }

      if (currentPoseFrames < minStableFrames) {
        return currentResult(true);
      }

      if (phase === 'waiting_for_body' && observedPose === 'standing') {
        phase = 'standing_ready';
        return currentResult(true);
      }

      // Only allow standing_ready → down_confirmed
      // User must first achieve stable standing before a squat can be counted
      if (observedPose === 'squatting' && phase === 'standing_ready') {
        phase = 'down_confirmed';
        return currentResult(true);
      }

      if (phase === 'down_confirmed' && observedPose === 'standing') {
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
