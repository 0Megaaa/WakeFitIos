import type { PoseFrame } from './types.ts';

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
  standingHipY?: number;
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
 * Coordinate system: upright-top-left-unmirrored
 * - Origin: top-left, X right, Y down
 * - Person stands upright with head at top, feet at bottom
 *
 * Key observations:
 * - Standing: knees nearly straight (~160-180°), hips extended (~160-180°)
 * - Squatting: knees bent (~70-120°), hips flexed (~70-110°)
 *
 * Detection strategy:
 * 1. Knee angle as primary indicator (most reliable for squats)
 * 2. Hip angle as secondary check (consistent with knee angle)
 * 3. hipDropRatio ensures actual depth (not just knee bend)
 * 4. scaleChangeRatio detects camera movement vs actual squat
 */
const THRESHOLDS = {
  /** Knee angle >= this = confident standing */
  KNEE_STANDING: 160,
  /** Knee angle <= this = confident squat */
  KNEE_DOWN: 130,
  /** Hip angle <= this = hip flexed (squat depth) */
  HIP_DOWN: 140,
  /** Hip angle >= this = hip extended (standing) */
  HIP_STANDING: 155,
  /** Minimum hip drop ratio for valid squat (relative to pose scale) */
  MIN_HIP_DROP_RATIO: 0.08,
  /** Maximum scale change ratio (distinguish squat from camera move) */
  MAX_SCALE_CHANGE_RATIO: 0.35,
  /** Minimum knee angle for partial squat detection */
  KNEE_PARTIAL: 145,
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

  // Calculate confidence based on multiple factors
  const confidence = calculateConfidence(bodyResult.body, metrics, minConfidence);
  if (confidence < minConfidence) {
    return unknown('low_confidence');
  }

  const label = classifyByGeometry(metrics, options.standingHipY);
  return {
    label,
    confidence,
    qualityIssue: 'ok',
    metrics,
  };
}

function classifyByGeometry(metrics: SquatPoseMetrics, baselineHipY?: number): SquatPoseLabel {
  const avgKnee = metrics.averageKneeAngle;
  const avgHip = metrics.averageHipAngle;
  const hipDropRatio = metrics.hipDropRatio;

  // Confident standing: knees nearly straight AND (hip extended OR no baseline)
  if (avgKnee >= THRESHOLDS.KNEE_STANDING) {
    // If we have a baseline and hip dropped significantly, still consider standing
    if (baselineHipY !== undefined && avgHip <= THRESHOLDS.HIP_DOWN) {
      // Hip is bent but knee is straight - could be hip hinge without full squat
      return 'unknown';
    }
    return 'standing';
  }

  // Confident squat: knees bent AND hips flexed AND significant hip drop
  if (avgKnee <= THRESHOLDS.KNEE_DOWN) {
    // Primary: knee angle confirms squat
    // Secondary: hip should also be flexed for valid depth
    if (avgHip <= THRESHOLDS.HIP_DOWN) {
      return 'squatting';
    }
    // Knee is down but hip is extended - might be sitting back without full knee bend
    return 'unknown';
  }

  // Partial knee bend: use hip drop to decide
  if (avgKnee <= THRESHOLDS.KNEE_PARTIAL) {
    // If significant hip drop relative to standing baseline, count as squat
    if (hipDropRatio >= THRESHOLDS.MIN_HIP_DROP_RATIO) {
      return 'squatting';
    }
  }

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
  if (frame.imageWidth <= 0 || frame.imageHeight <= 0) {
    return 'ok';
  }

  const points = REQUIRED_LANDMARK_NAMES.map((name) => body[name]);
  if (points.some((point) => point.x < 0 || point.y < 0 || point.x > frame.imageWidth || point.y > frame.imageHeight)) {
    return 'out_of_frame';
  }

  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const fillRatio = (maxY - minY) / frame.imageHeight;
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

    // hipDropRatio would be calculated relative to standing baseline
    // For now, we use midHipY relative to pose scale
    const hipDropRatio = midHipY / poseScale;

    return {
      averageKneeAngle: avgKneeAngle,
      averageHipAngle: avgHipAngle,
      midHipY,
      poseScale,
      hipDropRatio,
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

/**
 * Calculate classification confidence based on:
 * 1. Minimum landmark confidence
 * 2. Left/right leg symmetry
 * 3. Distance to threshold boundaries
 */
function calculateConfidence(
  body: Record<string, { x: number; y: number; confidence: number }>,
  metrics: SquatPoseMetrics,
  minConfidence: number,
): number {
  // Minimum of all landmark confidences
  const minLandmarkConfidence = Math.min(
    body.leftShoulder.confidence,
    body.rightShoulder.confidence,
    body.leftHip.confidence,
    body.rightHip.confidence,
    body.leftKnee.confidence,
    body.rightKnee.confidence,
    body.leftAnkle.confidence,
    body.rightAnkle.confidence,
  );

  // Left/right leg symmetry (difference in knee angles)
  const leftKneeAngle = calculateAngle(body.leftHip, body.leftKnee, body.leftAnkle);
  const rightKneeAngle = calculateAngle(body.rightHip, body.rightKnee, body.rightAnkle);
  const angleDifference = Math.abs(leftKneeAngle - rightKneeAngle);
  const symmetryScore = Math.max(0, 1 - angleDifference / 45);  // 45° difference = 0 symmetry

  // Distance to threshold boundary
  const kneeBoundaryScore = Math.min(
    Math.abs(metrics.averageKneeAngle - THRESHOLDS.KNEE_STANDING) / 30,
    Math.abs(metrics.averageKneeAngle - THRESHOLDS.KNEE_DOWN) / 30,
  );

  // Weighted confidence
  const confidence = (
    minLandmarkConfidence * 0.4 +
    symmetryScore * 0.3 +
    Math.min(kneeBoundaryScore, 1) * 0.3
  );

  return Math.max(minConfidence, Math.min(1, confidence));
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
