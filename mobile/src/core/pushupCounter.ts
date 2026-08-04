// Re-export from domain layer
export { calculateAngle, createPushUpCounter, createSquatCounter } from '../domain/exercise/pushupCounter.ts';
export { classifySquatPoseFrame } from '../domain/exercise/squatPoseClassifier.ts';
export type {
  PoseFrame,
  PoseLandmark,
  PoseLandmarkName,
  Point,
  ExerciseType,
  PushUpPhase,
  PushUpCounterOptions,
  SquatCounterOptions,
  PushUpCounterResult,
  PushUpCounter,
  SquatPoseLabel,
  SquatPoseQualityIssue,
  SquatPoseMetrics,
  SquatPoseClassification,
  SquatPoseClassifierOptions,
} from '../domain/exercise/index.ts';
