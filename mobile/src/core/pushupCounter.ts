import { classifySquatPoseFrame, type SquatPoseClassification } from './squatPoseClassifier.ts';

export type PoseLandmarkName =
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle';

export type Point = {
  x: number;
  y: number;
};

export type PoseLandmark = Point & {
  name: PoseLandmarkName;
  confidence: number;
};

export type PoseFrame = {
  timestampMs: number;
  imageWidth?: number;
  imageHeight?: number;
  landmarks: PoseLandmark[];
};

export type PushUpPhase = 'waiting_for_body' | 'ready' | 'down';

export type PushUpCounterOptions = {
  targetCount?: number;
  minConfidence?: number;
  downAngle?: number;
  upAngle?: number;
  minStableFrames?: number;
};
export type SquatCounterOptions = PushUpCounterOptions;

export type PushUpCounterResult = {
  count: number;
  phase: PushUpPhase;
  isPoseReady: boolean;
  isComplete: boolean;
  elbowAngle: number | null;
};

export type PushUpCounter = {
  handleFrame(frame: PoseFrame): PushUpCounterResult;
  reset(): PushUpCounterResult;
};

type RequiredSide = {
  shoulder: PoseLandmark;
  elbow: PoseLandmark;
  wrist: PoseLandmark;
  hip: PoseLandmark;
};
type RequiredLegSide = {
  hip: PoseLandmark;
  knee: PoseLandmark;
  ankle: PoseLandmark;
};

const DEFAULT_TARGET_COUNT = 5;
const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_DOWN_ANGLE = 90;
const DEFAULT_UP_ANGLE = 160;
const DEFAULT_MIN_STABLE_FRAMES = 2;
const SQUAT_CONFIDENT_DOWN_KNEE_ANGLE = 130;
const SQUAT_MIN_HIP_SHIFT_RATIO = 0.08;
const SQUAT_MAX_SCALE_CHANGE_RATIO = 0.35;
const SQUAT_MAX_MISSED_FRAMES = 4;
const SQUAT_DOWN_COUNT_COOLDOWN_MS = 900;
const SQUAT_STANDING_UNLOCK_FRAMES = 2;

export function calculateAngle(a: Point, vertex: Point, c: Point): number {
  const ab = { x: a.x - vertex.x, y: a.y - vertex.y };
  const cb = { x: c.x - vertex.x, y: c.y - vertex.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const abLength = Math.hypot(ab.x, ab.y);
  const cbLength = Math.hypot(cb.x, cb.y);

  if (abLength === 0 || cbLength === 0) {
    return 0;
  }

  const cosine = clamp(dot / (abLength * cbLength), -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function createPushUpCounter(options: PushUpCounterOptions = {}): PushUpCounter {
  const targetCount = normalizeTargetCount(options.targetCount);
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const downAngle = options.downAngle ?? DEFAULT_DOWN_ANGLE;
  const upAngle = options.upAngle ?? DEFAULT_UP_ANGLE;
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
      const observedPose = classifyPose(lastElbowAngle, downAngle, upAngle);

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

export function createSquatCounter(options: SquatCounterOptions = {}): PushUpCounter {
  const targetCount = normalizeTargetCount(options.targetCount);
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minStableFrames = Math.max(1, Math.trunc(options.minStableFrames ?? 1));

  let count = 0;
  let phase: PushUpPhase = 'waiting_for_body';
  let lastKneeAngle: number | null = null;
  let candidatePose: 'up' | 'down' | null = null;
  let candidateFrames = 0;
  let standingHipY: number | null = null;
  let standingPoseScale: number | null = null;
  let lastDebugKey: string | null = null;
  let missedFrames = 0;
  let lastCountedDownAtMs: number | null = null;
  let waitingForStandingUnlock = false;
  let stableStandingFrames = 0;

  function currentResult(isPoseReady: boolean): PushUpCounterResult {
    return {
      count,
      phase,
      isPoseReady,
      isComplete: count >= targetCount,
      elbowAngle: lastKneeAngle,
    };
  }

  function rememberStandingBaseline(classification: SquatPoseClassification): void {
    if (!classification.metrics) {
      return;
    }

    standingHipY = classification.metrics.midHipY;
    standingPoseScale = classification.metrics.poseScale;
  }

  function hasStableScale(classification: SquatPoseClassification): boolean {
    if (!classification.metrics || standingPoseScale === null || standingPoseScale === 0) {
      return true;
    }

    const scaleChangeRatio = Math.abs(classification.metrics.poseScale - standingPoseScale) / standingPoseScale;
    return scaleChangeRatio <= SQUAT_MAX_SCALE_CHANGE_RATIO;
  }

  function canCountDownEpisode(frame: PoseFrame): boolean {
    if (waitingForStandingUnlock) {
      return false;
    }
    if (phase === 'down') {
      return false;
    }
    if (lastCountedDownAtMs === null) {
      return true;
    }

    return frame.timestampMs - lastCountedDownAtMs >= SQUAT_DOWN_COUNT_COOLDOWN_MS;
  }

  function getHipDropRatio(classification: SquatPoseClassification): number | null {
    if (!classification.metrics || standingHipY === null || standingPoseScale === null || standingPoseScale === 0) {
      return null;
    }

    return (classification.metrics.midHipY - standingHipY) / standingPoseScale;
  }

  function toObservedPose(classification: SquatPoseClassification): 'up' | 'down' | null {
    if (classification.label === 'standing') {
      return 'up';
    }

    if (classification.label !== 'squatting') {
      return null;
    }

    const hipDropRatio = getHipDropRatio(classification);
    if (hipDropRatio === null) {
      return 'down';
    }

    if (
      Math.abs(hipDropRatio) >= SQUAT_MIN_HIP_SHIFT_RATIO
      || (classification.metrics?.averageKneeAngle ?? 180) <= SQUAT_CONFIDENT_DOWN_KNEE_ANGLE
    ) {
      return 'down';
    }

    return null;
  }

  function logDebug(frame: PoseFrame, classification: SquatPoseClassification, observedPose: 'up' | 'down' | null): void {
    if (!isReactNativeRuntime()) {
      return;
    }

    const metrics = classification.metrics;
    const knee = metrics ? Math.round(metrics.averageKneeAngle) : null;
    const hip = metrics ? Math.round(metrics.averageHipAngle) : null;
    const hipDrop = getHipDropRatio(classification);
    const debugKey = [
      classification.qualityIssue,
      classification.label,
      observedPose ?? 'none',
      phase,
      count,
      waitingForStandingUnlock ? 'locked' : 'unlocked',
      knee,
      hip,
      hipDrop === null ? null : Math.round(hipDrop * 100),
    ].join(':');

    if (debugKey === lastDebugKey) {
      return;
    }

    lastDebugKey = debugKey;
    console.log(
      [
        '[WakeFitSquat]',
        `t=${Math.round(frame.timestampMs)}`,
        `quality=${classification.qualityIssue}`,
        `label=${classification.label}`,
        `observed=${observedPose ?? 'none'}`,
        `phase=${phase}`,
        `count=${count}`,
        `lock=${waitingForStandingUnlock ? 'standing' : 'none'}`,
        `confidence=${classification.confidence.toFixed(2)}`,
        `knee=${knee ?? 'null'}`,
        `hip=${hip ?? 'null'}`,
        `hipDrop=${hipDrop === null ? 'null' : hipDrop.toFixed(2)}`,
        `scale=${metrics ? Math.round(metrics.poseScale) : 'null'}`,
        `image=${frame.imageWidth ?? 'unknown'}x${frame.imageHeight ?? 'unknown'}`,
      ].join(' '),
    );
  }

  return {
    handleFrame(frame: PoseFrame): PushUpCounterResult {
      const classification = classifySquatPoseFrame(frame, { minConfidence });
      lastKneeAngle = classification.metrics?.averageKneeAngle ?? null;
      const observedPose = toObservedPose(classification);

      if (classification.qualityIssue !== 'ok') {
        missedFrames += 1;
        if (phase === 'waiting_for_body' || missedFrames > SQUAT_MAX_MISSED_FRAMES) {
          phase = 'waiting_for_body';
          candidatePose = null;
          candidateFrames = 0;
          stableStandingFrames = 0;
          standingHipY = null;
          standingPoseScale = null;
        }
        logDebug(frame, classification, observedPose);
        return currentResult(false);
      }

      missedFrames = 0;

      if (!observedPose) {
        candidatePose = null;
        candidateFrames = 0;
        stableStandingFrames = 0;
        logDebug(frame, classification, observedPose);
        return currentResult(true);
      }

      if (candidatePose === observedPose) {
        candidateFrames += 1;
      } else {
        candidatePose = observedPose;
        candidateFrames = 1;
      }

      if (candidateFrames < minStableFrames) {
        logDebug(frame, classification, observedPose);
        return currentResult(true);
      }

      if (observedPose === 'up') {
        phase = 'ready';
        rememberStandingBaseline(classification);
        stableStandingFrames += 1;
        if (stableStandingFrames >= SQUAT_STANDING_UNLOCK_FRAMES) {
          waitingForStandingUnlock = false;
        }
        logDebug(frame, classification, observedPose);
        return currentResult(true);
      }

      if (phase !== 'down' && observedPose === 'down') {
        if (canCountDownEpisode(frame)) {
          count += 1;
          lastCountedDownAtMs = frame.timestampMs;
          waitingForStandingUnlock = true;
        }
        phase = 'down';
      }
      stableStandingFrames = 0;

      logDebug(frame, classification, observedPose);
      return currentResult(true);
    },

    reset(): PushUpCounterResult {
      count = 0;
      phase = 'waiting_for_body';
      lastKneeAngle = null;
      candidatePose = null;
      candidateFrames = 0;
      standingHipY = null;
      standingPoseScale = null;
      lastDebugKey = null;
      missedFrames = 0;
      lastCountedDownAtMs = null;
      waitingForStandingUnlock = false;
      stableStandingFrames = 0;
      return currentResult(false);
    },
  };
}

function getBestConfidentSide(frame: PoseFrame, minConfidence: number): RequiredSide | null {
  const left = getConfidentSide(frame, 'left', minConfidence);
  const right = getConfidentSide(frame, 'right', minConfidence);

  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return averageConfidence(right) > averageConfidence(left) ? right : left;
}

function getBestConfidentLegSide(frame: PoseFrame, minConfidence: number): RequiredLegSide | null {
  const left = getConfidentLegSide(frame, 'left', minConfidence);
  const right = getConfidentLegSide(frame, 'right', minConfidence);

  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return averageLegConfidence(right) > averageLegConfidence(left) ? right : left;
}

function getConfidentSide(
  frame: PoseFrame,
  side: 'left' | 'right',
  minConfidence: number,
): RequiredSide | null {
  const byName = new Map(frame.landmarks.map((item) => [item.name, item]));
  const shoulder = byName.get(`${side}Shoulder` as PoseLandmarkName);
  const elbow = byName.get(`${side}Elbow` as PoseLandmarkName);
  const wrist = byName.get(`${side}Wrist` as PoseLandmarkName);
  const hip = byName.get(`${side}Hip` as PoseLandmarkName);

  if (!shoulder || !elbow || !wrist || !hip) {
    return null;
  }

  if ([shoulder, elbow, wrist, hip].some((item) => item.confidence < minConfidence)) {
    return null;
  }

  return { shoulder, elbow, wrist, hip };
}

function getConfidentLegSide(
  frame: PoseFrame,
  side: 'left' | 'right',
  minConfidence: number,
): RequiredLegSide | null {
  const byName = new Map(frame.landmarks.map((item) => [item.name, item]));
  const hip = byName.get(`${side}Hip` as PoseLandmarkName);
  const knee = byName.get(`${side}Knee` as PoseLandmarkName);
  const ankle = byName.get(`${side}Ankle` as PoseLandmarkName);

  if (!hip || !knee || !ankle) {
    return null;
  }

  if ([hip, knee, ankle].some((item) => item.confidence < minConfidence)) {
    return null;
  }

  return { hip, knee, ankle };
}

function averageConfidence(side: RequiredSide): number {
  return (side.shoulder.confidence + side.elbow.confidence + side.wrist.confidence + side.hip.confidence) / 4;
}

function averageLegConfidence(side: RequiredLegSide): number {
  return (side.hip.confidence + side.knee.confidence + side.ankle.confidence) / 3;
}

type LegMetrics = {
  kneeAngle: number;
  hipY: number;
  legLength: number;
};

function getLegMetrics(side: RequiredLegSide): LegMetrics {
  return {
    kneeAngle: calculateAngle(side.hip, side.knee, side.ankle),
    hipY: side.hip.y,
    legLength: distance(side.hip, side.knee) + distance(side.knee, side.ankle),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function classifyPose(angle: number, downAngle: number, upAngle: number): 'up' | 'down' | null {
  if (angle >= upAngle) {
    return 'up';
  }
  if (angle < downAngle) {
    return 'down';
  }

  return null;
}

function normalizeTargetCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TARGET_COUNT;
  }

  return clamp(Math.trunc(value), 1, 100);
}

function isReactNativeRuntime(): boolean {
  return (globalThis as { navigator?: { product?: string } }).navigator?.product === 'ReactNative';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
