import type { Point, PoseFrame, PoseLandmark, PoseLandmarkName } from './pushupCounter.ts';

export type SquatPoseLabel = 'standing' | 'squatting' | 'unknown';

export type SquatPoseQualityIssue =
  | 'ok'
  | 'partial_body'
  | 'low_confidence'
  | 'too_close'
  | 'too_far';

export type SquatPoseMetrics = {
  averageKneeAngle: number;
  averageHipAngle: number;
  midHipY: number;
  poseScale: number;
};

export type SquatPoseClassification = {
  label: SquatPoseLabel;
  confidence: number;
  qualityIssue: SquatPoseQualityIssue;
  metrics: SquatPoseMetrics | null;
};

export type SquatPoseClassifierOptions = {
  minConfidence?: number;
  k?: number;
};

type RequiredFullBody = {
  leftShoulder: PoseLandmark;
  rightShoulder: PoseLandmark;
  leftHip: PoseLandmark;
  rightHip: PoseLandmark;
  leftKnee: PoseLandmark;
  rightKnee: PoseLandmark;
  leftAnkle: PoseLandmark;
  rightAnkle: PoseLandmark;
};

type SquatPoseSample = {
  label: Exclude<SquatPoseLabel, 'unknown'>;
  embedding: number[];
};

const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_K = 3;
const MIN_BODY_FILL_RATIO = 0.32;
const MAX_BODY_FILL_RATIO = 0.92;
const MIN_CLASSIFIER_CONFIDENCE = 0.56;
const REQUIRED_LANDMARKS: Array<keyof RequiredFullBody> = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

const defaultSamples = createDefaultSamples();

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

  const embedding = createSquatEmbedding(bodyResult.body);
  if (!embedding) {
    return unknown('partial_body');
  }

  const metrics = getSquatPoseMetrics(bodyResult.body);
  const votes = defaultSamples
    .map((sample) => ({
      label: sample.label,
      distance: euclideanDistance(sample.embedding, embedding),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(1, Math.trunc(options.k ?? DEFAULT_K)));

  const scores = new Map<Exclude<SquatPoseLabel, 'unknown'>, number>();
  let totalScore = 0;
  for (const vote of votes) {
    const score = 1 / Math.max(vote.distance, 0.000001);
    totalScore += score;
    scores.set(vote.label, (scores.get(vote.label) ?? 0) + score);
  }

  const standingScore = scores.get('standing') ?? 0;
  const squattingScore = scores.get('squatting') ?? 0;
  const label = squattingScore > standingScore ? 'squatting' : 'standing';
  const confidence = totalScore === 0 ? 0 : Math.max(standingScore, squattingScore) / totalScore;

  if (confidence < MIN_CLASSIFIER_CONFIDENCE) {
    return {
      label: 'unknown',
      confidence,
      qualityIssue: 'ok',
      metrics,
    };
  }

  return {
    label,
    confidence,
    qualityIssue: 'ok',
    metrics,
  };
}

function getRequiredFullBody(
  frame: PoseFrame,
  minConfidence: number,
): { body: RequiredFullBody | null; qualityIssue: SquatPoseQualityIssue } {
  const byName = new Map(frame.landmarks.map((item) => [item.name, item]));
  const body = {} as RequiredFullBody;

  for (const name of REQUIRED_LANDMARKS) {
    const landmark = byName.get(name);
    if (!landmark) {
      return { body: null, qualityIssue: 'partial_body' };
    }
    if (landmark.confidence < minConfidence) {
      return { body: null, qualityIssue: 'low_confidence' };
    }

    body[name] = landmark;
  }

  return { body, qualityIssue: 'ok' };
}

function getFrameFitIssue(frame: PoseFrame, body: RequiredFullBody): SquatPoseQualityIssue {
  if (!Number.isFinite(frame.imageWidth) || !Number.isFinite(frame.imageHeight)) {
    return 'ok';
  }

  const imageWidth = Number(frame.imageWidth);
  const imageHeight = Number(frame.imageHeight);
  if (imageWidth <= 0 || imageHeight <= 0) {
    return 'ok';
  }

  const points = REQUIRED_LANDMARKS.map((name) => body[name]);
  if (points.some((point) => point.x < 0 || point.y < 0 || point.x > imageWidth || point.y > imageHeight)) {
    return 'partial_body';
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

function createSquatEmbedding(body: RequiredFullBody): number[] | null {
  const normalized = normalizeBody(body);
  if (!normalized) {
    return null;
  }

  const points = normalized.points;
  const midHip = midpoint(points.leftHip, points.rightHip);
  const midShoulder = midpoint(points.leftShoulder, points.rightShoulder);
  const midAnkle = midpoint(points.leftAnkle, points.rightAnkle);
  const averageKneeAngle = (
    calculateAngle(points.leftHip, points.leftKnee, points.leftAnkle)
    + calculateAngle(points.rightHip, points.rightKnee, points.rightAnkle)
  ) / 2;
  const averageHipAngle = (
    calculateAngle(points.leftShoulder, points.leftHip, points.leftKnee)
    + calculateAngle(points.rightShoulder, points.rightHip, points.rightKnee)
  ) / 2;
  const hipWidth = distance(points.leftHip, points.rightHip);
  const ankleWidth = distance(points.leftAnkle, points.rightAnkle);
  const kneeWidth = distance(points.leftKnee, points.rightKnee);

  return [
    averageKneeAngle / 180,
    averageHipAngle / 180,
    distance(midHip, midAnkle),
    distance(midShoulder, midHip),
    safeRatio(kneeWidth, hipWidth),
    safeRatio(kneeWidth, ankleWidth),
    safeRatio(ankleWidth, hipWidth),
    points.leftKnee.x - points.leftAnkle.x,
    points.rightAnkle.x - points.rightKnee.x,
  ];
}

function getSquatPoseMetrics(body: RequiredFullBody): SquatPoseMetrics {
  const midHip = midpoint(body.leftHip, body.rightHip);
  return {
    averageKneeAngle: (
      calculateAngle(body.leftHip, body.leftKnee, body.leftAnkle)
      + calculateAngle(body.rightHip, body.rightKnee, body.rightAnkle)
    ) / 2,
    averageHipAngle: (
      calculateAngle(body.leftShoulder, body.leftHip, body.leftKnee)
      + calculateAngle(body.rightShoulder, body.rightHip, body.rightKnee)
    ) / 2,
    midHipY: midHip.y,
    poseScale: getPoseScale(body),
  };
}

function normalizeBody(body: RequiredFullBody): { points: RequiredFullBody; scale: number } | null {
  const center = midpoint(body.leftHip, body.rightHip);
  const scale = getPoseScale(body);
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  const normalized = {} as RequiredFullBody;
  for (const name of REQUIRED_LANDMARKS) {
    const point = body[name];
    normalized[name] = {
      ...point,
      x: (point.x - center.x) / scale,
      y: (point.y - center.y) / scale,
    };
  }

  return { points: normalized, scale };
}

function getPoseScale(body: RequiredFullBody): number {
  const points = REQUIRED_LANDMARKS.map((name) => body[name]);
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

function createDefaultSamples(): SquatPoseSample[] {
  const sampleFrames = [
    sample('standing', {
      leftShoulder: [90, 100],
      rightShoulder: [210, 100],
      leftHip: [110, 240],
      rightHip: [190, 240],
      leftKnee: [115, 400],
      rightKnee: [185, 400],
      leftAnkle: [120, 560],
      rightAnkle: [180, 560],
    }),
    sample('standing', {
      leftShoulder: [92, 95],
      rightShoulder: [208, 95],
      leftHip: [112, 238],
      rightHip: [188, 238],
      leftKnee: [120, 395],
      rightKnee: [180, 395],
      leftAnkle: [124, 552],
      rightAnkle: [176, 552],
    }),
    sample('standing', {
      leftShoulder: [88, 108],
      rightShoulder: [212, 108],
      leftHip: [108, 248],
      rightHip: [192, 248],
      leftKnee: [108, 408],
      rightKnee: [192, 408],
      leftAnkle: [112, 562],
      rightAnkle: [188, 562],
    }),
    sample('squatting', {
      leftShoulder: [85, 130],
      rightShoulder: [215, 130],
      leftHip: [115, 330],
      rightHip: [185, 330],
      leftKnee: [85, 410],
      rightKnee: [215, 410],
      leftAnkle: [120, 560],
      rightAnkle: [180, 560],
    }),
    sample('squatting', {
      leftShoulder: [90, 145],
      rightShoulder: [210, 145],
      leftHip: [118, 350],
      rightHip: [182, 350],
      leftKnee: [80, 430],
      rightKnee: [220, 430],
      leftAnkle: [122, 560],
      rightAnkle: [178, 560],
    }),
    sample('squatting', {
      leftShoulder: [86, 125],
      rightShoulder: [214, 125],
      leftHip: [112, 318],
      rightHip: [188, 318],
      leftKnee: [92, 406],
      rightKnee: [208, 406],
      leftAnkle: [118, 558],
      rightAnkle: [182, 558],
    }),
  ];

  return sampleFrames
    .map(({ label, body }) => {
      const embedding = createSquatEmbedding(body);
      return embedding ? { label, embedding } : null;
    })
    .filter((item): item is SquatPoseSample => item !== null);
}

function sample(
  label: Exclude<SquatPoseLabel, 'unknown'>,
  points: Record<keyof RequiredFullBody, [number, number]>,
): { label: Exclude<SquatPoseLabel, 'unknown'>; body: RequiredFullBody } {
  const body = {} as RequiredFullBody;
  for (const name of REQUIRED_LANDMARKS) {
    const point = points[name];
    body[name] = {
      name: name as PoseLandmarkName,
      x: point[0],
      y: point[1],
      confidence: 0.95,
    };
  }

  return { label, body };
}

function unknown(qualityIssue: SquatPoseQualityIssue): SquatPoseClassification {
  return {
    label: 'unknown',
    confidence: 0,
    qualityIssue,
    metrics: null,
  };
}

function calculateAngle(a: Point, vertex: Point, c: Point): number {
  const ab = { x: a.x - vertex.x, y: a.y - vertex.y };
  const cb = { x: c.x - vertex.x, y: c.y - vertex.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const length = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);

  if (length === 0) {
    return 0;
  }

  return (Math.acos(clamp(dot / length, -1, 1)) * 180) / Math.PI;
}

function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function safeRatio(value: number, divisor: number): number {
  return divisor === 0 ? 0 : value / divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
