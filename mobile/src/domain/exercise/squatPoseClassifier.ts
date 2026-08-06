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
  scaleChangeRatio: number;
  leftKneeAngle: number;
  rightKneeAngle: number;
};

export type SquatPoseClassification = {
  label: SquatPoseLabel;
  confidence: number;
  qualityIssue: SquatPoseQualityIssue;
  metrics: SquatPoseMetrics | null;
};

export type SquatPoseClassifierOptions = {
  minConfidence?: number;
  standingBaselineHipY?: number;
  standingBaselineScale?: number;
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
 * Detection strategy:
 * 1. Knee angle as primary indicator (most reliable for squats)
 * 2. Hip angle as secondary check (consistent with knee angle)
 * 3. hipDropRatio ensures actual depth (hip must move down relative to standing baseline)
 * 4. scaleChangeRatio detects camera movement vs actual squat
 *
 * All ratios are calculated relative to standing baseline:
 * - hipDropRatio = (currentMidHipY - standingBaselineHipY) / standingBaselineScale
 * - scaleChangeRatio = |currentPoseScale - standingBaselineScale| / standingBaselineScale
 */
const THRESHOLDS = {
  /** Knee angle >= this = confident standing */
  KNEE_STANDING: 160,
  /** Knee angle <= this = confident squat (strong bend) */
  KNEE_DOWN_STRONG: 120,
  /** Knee angle <= this = partial squat */
  KNEE_DOWN_PARTIAL: 140,
  /** Hip angle >= this = hip extended (standing) */
  HIP_STANDING: 155,
  /** Hip angle <= this = hip flexed (squat depth) */
  HIP_DOWN: 120,
  /** Minimum hip drop ratio for valid squat */
  MIN_HIP_DROP_RATIO: 0.05,
  /** Maximum scale change ratio (distinguish squat from camera move) */
  MAX_SCALE_CHANGE_RATIO: 0.30,
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

  const metrics = getSquatPoseMetrics(bodyResult.body, options);
  if (!metrics) {
    return unknown('partial_body');
  }

  // Calculate confidence based on multiple factors
  const confidence = calculateConfidence(bodyResult.body, metrics, minConfidence);
  if (confidence < minConfidence) {
    return unknown('low_confidence');
  }

  const label = classifyByGeometry(metrics, options);
  return {
    label,
    confidence,
    qualityIssue: 'ok',
    metrics,
  };
}

function classifyByGeometry(metrics: SquatPoseMetrics, options: SquatPoseClassifierOptions): SquatPoseLabel {
  const avgKnee = metrics.averageKneeAngle;
  const avgHip = metrics.averageHipAngle;
  const hipDropRatio = metrics.hipDropRatio;
  const scaleChangeRatio = metrics.scaleChangeRatio;

  // Reject if scale change is too large (likely camera movement, not squat)
  if (scaleChangeRatio > THRESHOLDS.MAX_SCALE_CHANGE_RATIO) {
    return 'unknown';
  }

  // Confident standing: knees nearly straight
  if (avgKnee >= THRESHOLDS.KNEE_STANDING) {
    return 'standing';
  }

  // Strong squat: knee angle deeply bent
  if (avgKnee <= THRESHOLDS.KNEE_DOWN_STRONG) {
    // Deep knee bend - this is the primary indicator of a squat
    // Accept if hip is also flexed (angle < 140 indicates hip flexion from standing ~175°)
    if (avgHip < 140) {
      return 'squatting';
    }
    return 'unknown';
  }

  // Partial squat: knee moderately bent
  if (avgKnee <= THRESHOLDS.KNEE_DOWN_PARTIAL) {
    // For partial squat, require significant hip drop AND hip flexed
    if (hipDropRatio >= THRESHOLDS.MIN_HIP_DROP_RATIO && avgHip < 140) {
      return 'squatting';
    }
    // Hip didn't drop enough - might be just bending knees without actual squat
    return 'unknown';
  }

  // Shallow bend - likely not a squat
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

function getSquatPoseMetrics(
  body: Record<string, { x: number; y: number; confidence: number }>,
  options: SquatPoseClassifierOptions,
): SquatPoseMetrics | null {
  try {
    const leftKneeAngle = calculateAngle(body.leftHip, body.leftKnee, body.leftAnkle);
    const rightKneeAngle = calculateAngle(body.rightHip, body.rightKnee, body.rightAnkle);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;

    const leftHipAngle = calculateAngle(body.leftShoulder, body.leftHip, body.leftKnee);
    const rightHipAngle = calculateAngle(body.rightShoulder, body.rightHip, body.rightKnee);
    const avgHipAngle = (leftHipAngle + rightHipAngle) / 2;

    const midHipY = (body.leftHip.y + body.rightHip.y) / 2;
    const poseScale = getPoseScale(body);

    // Calculate hip drop ratio relative to standing baseline
    // If no baseline provided, use poseScale as reference
    const standingScale = options.standingBaselineScale ?? poseScale;
    const standingHipY = options.standingBaselineHipY ?? midHipY;

    // hipDropRatio = (currentHipY - standingHipY) / standingScale
    // Positive value means hip moved DOWN (larger Y) relative to standing
    const hipDropRatio = standingScale > 0
      ? (midHipY - standingHipY) / standingScale
      : 0;

    // scaleChangeRatio = |currentScale - standingScale| / standingScale
    const scaleChangeRatio = standingScale > 0
      ? Math.abs(poseScale - standingScale) / standingScale
      : 0;

    return {
      leftKneeAngle,
      rightKneeAngle,
      averageKneeAngle: avgKneeAngle,
      averageHipAngle: avgHipAngle,
      midHipY,
      poseScale,
      hipDropRatio,
      scaleChangeRatio,
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
  const boxHeight = maxY - minY;
  const torsoSize = distance(
    midpoint(body.leftShoulder, body.rightShoulder),
    midpoint(body.leftHip, body.rightHip),
  );

  // Use torso height as the primary scale reference for consistent ratios
  return torsoSize > 0 ? torsoSize : boxHeight;
}

/**
 * Calculate classification confidence based on:
 * 1. Minimum landmark confidence
 * 2. Left/right leg symmetry (angle difference)
 * 3. Distance to threshold boundaries
 * 4. Scale stability
 */
function calculateConfidence(
  body: Record<string, { x: number; y: number; confidence: number }>,
  metrics: SquatPoseMetrics,
  minConfidence: number,
): number {
  // Minimum of all landmark confidences
  const confidences = REQUIRED_LANDMARK_NAMES.map((name) => body[name].confidence);
  const minLandmarkConfidence = Math.min(...confidences);

  // Left/right leg symmetry (difference in knee angles)
  const kneeAngleDifference = Math.abs(metrics.leftKneeAngle - metrics.rightKneeAngle);
  const symmetryScore = Math.max(0, 1 - kneeAngleDifference / 45);

  // Distance to threshold boundary
  const kneeBoundaryScore = Math.min(
    Math.abs(metrics.averageKneeAngle - THRESHOLDS.KNEE_STANDING) / 30,
    Math.abs(metrics.averageKneeAngle - THRESHOLDS.KNEE_DOWN_PARTIAL) / 30,
  );

  // Scale stability score (inverse of scale change)
  const scaleScore = Math.max(0, 1 - metrics.scaleChangeRatio / THRESHOLDS.MAX_SCALE_CHANGE_RATIO);

  // Weighted confidence
  const confidence = (
    minLandmarkConfidence * 0.4 +
    symmetryScore * 0.25 +
    Math.min(kneeBoundaryScore, 1) * 0.20 +
    scaleScore * 0.15
  );

  return Math.max(0, Math.min(1, confidence));
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
