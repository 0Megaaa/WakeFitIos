/**
 * Camera Facing
 *
 * Represents which physical camera lens is active.
 * "front" = front-facing (selfie) camera
 * "back" = rear camera
 */
export type CameraFacing = 'front' | 'back';

/**
 * Pose Detection Source
 *
 * Indicates which ML framework produced the pose data.
 */
export type PoseSource = 'apple-vision' | 'mlkit';

/**
 * Coordinate Space
 *
 * All PoseFrame coordinates follow this contract:
 * - Origin: top-left corner of the image
 * - X: increases to the right
 * - Y: increases downward
 * - Represents upright portrait orientation
 * - NOT mirrored regardless of front camera preview
 *
 * iOS Vision returns normalized [0,1] coordinates with origin at bottom-left.
 * Android MLKit returns normalized [0,1] coordinates with origin at top-left.
 * Both are transformed to this space before emitting PoseFrame events.
 */
export type CoordinateSpace = 'upright-top-left-unmirrored';
