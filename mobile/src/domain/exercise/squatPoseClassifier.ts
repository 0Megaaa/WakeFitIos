import type { PoseFrame, Point } from './types.ts';

export type SquatPoseLabel = 'standing' | 'squatting' | 'unknown';

export type SquatPoseQualityIssue =
  | 'ok'
  | 'partial_body'
  | 'low_confidence'
  | 'out_of_frame'
  | 'too_close'
  | 'too_far';

export type SquatPoseMetrics = {
  averageKneeAngle: number;
  averageHipAngle: number;
  midHipY: number;
  poseScale: number;
  hipDropRatio: number;
};

export type SquatPoseClassification = {
  label: SquatPoseLabel;
  confidence: number;
  qualityIssue: SquatPoseQualityIssue;
  metrics: SquatPoseMetrics | null;
};

export type SquatPoseClassifierOptions = {
  minConfidence?: number;
};

type RequiredFullBody = {
  leftShoulder: { x: number; y: number; confidence: number };
  rightShoulder: { x: number; y: number; confidence: number };
  leftHip: { x: number; y: number; confidence: number };
  rightHip: { x: number; y: number; confidence: number };
  leftKnee: { x: number; y: number; confidence: number };
  rightKnee: { x: number; y: number; confidence: number };
  leftAnkle: { x: number; y: number; confidence: number };
  rightAnkle: { x: number; y: number; confidence: number };
};

const REQUIRED_LANDMARK_NAMES = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;

/**
 * Geometric squat classifier thresholds.
 *
 * All angles are in degrees, normalized to the upright-top-left-unmirrored coordinate space.
 * Left/right refer to the test subject's left/right, NOT screen left/right.
 *
 * Key observations for a person facing the camera in portrait orientation:
 * - Standing: knees nearly straight (~175°), hips extended (~170°)
 * - Squatting: knees bent (~70-100°), hips flexed (~70-100°)
 *
 * These thresholds are calibrated for portrait video (head at top, feet at bottom).
 */
const GEOMETRIC_THRESHOLDS = {
  /** Knee angle below this = confident down pose (degrees, measured at knee) */
  KNEE_DOWN_THRESHOLD: 130,
  /** Hip angle below this = confident down pose (degrees, measured at hip) */
  HIP_DOWN_THRESHOLD: 140,
  /**
   * Minimum hip drop (as fraction of pose scale) to count as a squat.
   * Positive = hip moves DOWN in image coordinates (toward larger Y).
   */
  MIN_HIP_DROP_RATIO: 0.08,
  /**
   * Maximum scale change ratio to distinguish squat from camera movement.
   * A person moving toward/away from camera causes pose scale to change.
   * Squatting in place should not change scale dramatically.
   */
  MAX_SCALE_CHANGE_RATIO: 0.35,
  /**
   * Knee angle above this = confident standing (degrees).
   * Used to determine when a down phase is truly complete.
   */
  KNEE_STANDING_THRESHOLD: 160,
} as const;

const DEFAULT_MIN_CONFIDENCE = 0.55;
const MIN_BODY_FILL_RATIO = 0.32;
const MAX_BODY_FILL_RATIO = 0.92;

export function classifySquatPoseFrame(
  frame: PoseFrame,
  options: SquatPoseClassifierOptions = {},
): SquatPoseClassification {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const bodyResult = getRequiredFullBody(frame, minConfidence);
  if (!bodyResult.body) {
    return unknown(bodyResult.qualityIssue);
  }

  const frameFitIssue = getFrameFitIssue(frame, bodyResult.body);
  if (frameFitIssue !== 'ok') {
    return unknown(frameFitIssue);
  }

  const metrics = getSquatPoseMetrics(bodyResult.body);
  if (!metrics) {
    return unknown('partial_body');
  }

  const label = classifyByGeometry(metrics);
  return {
    label,
    confidence: 1.0,
    qualityIssue: 'ok',
    metrics,
  };
}

function classifyByGeometry(metrics: SquatPoseMetrics): SquatPoseLabel {
  const avgKnee = metrics.averageKneeAngle;
  const avgHip = metrics.averageHipAngle;

  // Confident standing: knees nearly straight
  if (avgKnee >= GEOMETRIC_THRESHOLDS.KNEE_STANDING_THRESHOLD) {
    return 'standing';
  }

  // Confident squat: knee is significantly bent
  // Use knee angle as primary indicator since it's most reliable for squat detection
  if (avgKnee <= GEOMETRIC_THRESHOLDS.KNEE_DOWN_THRESHOLD) {
    return 'squatting';
  }

  // Partial bend - not clearly standing or squatting
  return 'unknown';
}

function getRequiredFullBody(
  frame: PoseFrame,
  minConfidence: number,
): { body: RequiredFullBody | null; qualityIssue: SquatPoseQualityIssue } {
  const byName = new Map<string, { x: number; y: number; confidence: number }>();
  for (const item of frame.landmarks) {
    byName.set(item.name, item);
  }
  const body: Record<string, { x: number; y: number; confidence: number }> = {};

  for (const name of REQUIRED_LANDMARK_NAMES) {
    const landmark = byName.get(name);
    if (!landmark) {
      return { body: null, qualityIssue: 'partial_body' };
    }
    if (landmark.confidence < minConfidence) {
      return { body: null, qualityIssue: 'low_confidence' };
    }
    body[name] = landmark;
  }

  return { body: body as unknown as RequiredFullBody, qualityIssue: 'ok' };
}

function getFrameFitIssue(frame: PoseFrame, body: Record<string, { x: number; y: number; confidence: number }>): SquatPoseQualityIssue {
  if (!Number.isFinite(frame.imageWidth) || !Number.isFinite(frame.imageHeight)) {
    return 'ok';
  }

  const imageWidth = Number(frame.imageWidth);
  const imageHeight = Number(frame.imageHeight);
  if (imageWidth <= 0 || imageHeight <= 0) {
    return 'ok';
  }

  const points = REQUIRED_LANDMARK_NAMES.map((name) => body[name]);
  if (points.some((point) => point.x < 0 || point.y < 0 || point.x > imageWidth || point.y > imageHeight)) {
    return 'out_of_frame';
  }

  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const fillRatio = (maxY - minY) / imageHeight;
  if (fillRatio > MAX_BODY_FILL_RATIO) {
    return 'too_close';
  }
  if (fillRatio < MIN_BODY_FILL_RATIO) {
    return 'too_far';
  }

  return 'ok';
}

function getSquatPoseMetrics(body: Record<string, { x: number; y: number; confidence: number }>): SquatPoseMetrics | null {
  try {
    const avgKneeAngle = (
      calculateAngle(body.leftHip, body.leftKnee, body.leftAnkle)
      + calculateAngle(body.rightHip, body.rightKnee, body.rightAnkle)
    ) / 2;

    const avgHipAngle = (
      calculateAngle(body.leftShoulder, body.leftHip, body.leftKnee)
      + calculateAngle(body.rightShoulder, body.rightHip, body.rightKnee)
    ) / 2;

    const midHipY = (body.leftHip.y + body.rightHip.y) / 2;
    const poseScale = getPoseScale(body);

    return {
      averageKneeAngle: avgKneeAngle,
      averageHipAngle: avgHipAngle,
      midHipY,
      poseScale,
      hipDropRatio: 0,
    };
  } catch {
    return null;
  }
}

function getPoseScale(body: Record<string, { x: number; y: number; confidence: number }>): number {
  const points = REQUIRED_LANDMARK_NAMES.map((name) => body[name]);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const boxSize = Math.max(maxX - minX, maxY - minY);
  const torsoSize = distance(
    midpoint(body.leftShoulder, body.rightShoulder),
    midpoint(body.leftHip, body.rightHip),
  );

  return Math.max(boxSize, torsoSize * 2.5);
}

function unknown(qualityIssue: SquatPoseQualityIssue): SquatPoseClassification {
  return {
    label: 'unknown',
    confidence: 0,
    qualityIssue,
    metrics: null,
  };
}

function calculateAngle(a: { x: number; y: number }, vertex: { x: number; y: number }, c: { x: number; y: number }): number {
  const ab = { x: a.x - vertex.x, y: a.y - vertex.y };
  const cb = { x: c.x - vertex.x, y: c.y - vertex.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const length = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);

  if (length === 0) {
    return 180;
  }

  return (Math.acos(clamp(dot / length, -1, 1)) * 180) / Math.PI;
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
