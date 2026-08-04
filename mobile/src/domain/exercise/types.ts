export type ExerciseType = 'push_up' | 'squat';

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
