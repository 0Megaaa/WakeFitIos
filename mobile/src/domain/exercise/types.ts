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

/**
 * PoseFrame - Unified cross-platform pose detection event
 *
 * Coordinate contract: upright-top-left-unmirrored
 * - Origin: top-left of image
 * - X: increases rightward
 * - Y: increases downward
 * - Upright portrait orientation
 * - NOT mirrored even on front camera
 *
 * Required fields:
 * - imageWidth/imageHeight: dimensions of the canonical image space
 * - cameraFacing: which physical camera was used (front/back)
 * - source: which ML framework produced the data (apple-vision/mlkit)
 * - coordinateSpace: always 'upright-top-left-unmirrored'
 */
export type PoseFrame = {
  timestampMs: number;
  /** Image width in canonical coordinate space */
  imageWidth: number;
  /** Image height in canonical coordinate space */
  imageHeight: number;
  landmarks: PoseLandmark[];
  /** Which camera lens was used to capture this frame */
  cameraFacing: 'front' | 'back';
  /** Which ML framework produced this pose data */
  source: 'apple-vision' | 'mlkit';
  /**
   * Coordinate space of landmark coordinates.
   * Always 'upright-top-left-unmirrored'.
   * Left/right landmarks refer to the test subject's left/right, not screen left/right.
   */
  coordinateSpace: 'upright-top-left-unmirrored';
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
  /** Reset temporary tracking state but preserve the count.
   * Used when switching cameras to clear down/standing state. */
  resetTrackingStatePreservingCount(): PushUpCounterResult;
};
