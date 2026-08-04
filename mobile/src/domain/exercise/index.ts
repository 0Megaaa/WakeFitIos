export type {
  ExerciseType,
  PoseLandmarkName,
  Point,
  PoseLandmark,
  PoseFrame,
  PushUpPhase,
  PushUpCounterOptions,
  SquatCounterOptions,
  PushUpCounterResult,
  PushUpCounter,
} from './types.ts';

export { calculateAngle, createPushUpCounter, createSquatCounter } from './pushupCounter.ts';
export { classifySquatPoseFrame } from './squatPoseClassifier.ts';
export type {
  SquatPoseLabel,
  SquatPoseQualityIssue,
  SquatPoseMetrics,
  SquatPoseClassification,
  SquatPoseClassifierOptions,
} from './squatPoseClassifier.ts';
