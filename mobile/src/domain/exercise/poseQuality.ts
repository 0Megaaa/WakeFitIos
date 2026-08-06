import type { PoseFrame, PoseLandmarkName } from './types.ts';

export type PoseQualityIssue =
  | 'ok'
  | 'partial_body'
  | 'low_confidence'
  | 'out_of_frame'
  | 'too_close'
  | 'too_far';

export type PoseQualityMetrics = {
  visibleLandmarkCount: number;
  requiredLandmarkCount: number;
  minConfidence: number;
  bodyFillRatio: number | null;
};

export type PoseQualityResult = {
  issue: PoseQualityIssue;
  guidance: string;
  metrics: PoseQualityMetrics;
};

type RequiredBodyLandmarks = {
  leftShoulder: boolean;
  rightShoulder: boolean;
  leftHip: boolean;
  rightHip: boolean;
  leftKnee: boolean;
  rightKnee: boolean;
  leftAnkle: boolean;
  rightAnkle: boolean;
};

// Squat requires all 8 lower body landmarks visible
const SQUAT_REQUIRED_LANDMARKS: Array<keyof RequiredBodyLandmarks> = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

// Push-up requires upper body landmarks (no ankles)
type RequiredPushupLandmarks = RequiredBodyLandmarks & {
  leftElbow: boolean;
  rightElbow: boolean;
  leftWrist: boolean;
  rightWrist: boolean;
};

const PUSHUP_REQUIRED_LANDMARKS: Array<keyof RequiredPushupLandmarks> = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
];

const GUIDANCE: Record<PoseQualityIssue, string> = {
  ok: '全身已识别，可以开始深蹲',
  partial_body: '请后退并确保头部、肩部、髋部、膝盖和脚踝全部入镜',
  low_confidence: '识别不稳定，请保持光线充足并站稳',
  out_of_frame: '请后退并确保头部、肩部、髋部、膝盖和脚踝全部入镜',
  too_close: '请后退一些，确保全身完整显示',
  too_far: '请靠近一些',
};

function getRequiredLandmarks(exerciseType: string): Array<string> {
  return exerciseType === 'squat' ? SQUAT_REQUIRED_LANDMARKS : PUSHUP_REQUIRED_LANDMARKS;
}

export function evaluatePoseQuality(
  frame: PoseFrame,
  options: { exerciseType?: string; minConfidence?: number } = {},
): PoseQualityResult {
  const exerciseType = options.exerciseType ?? 'squat';
  const minConfidence = options.minConfidence ?? 0.55;
  const requiredLandmarks = getRequiredLandmarks(exerciseType);

  const byName = new Map<string, { x: number; y: number; confidence: number }>();
  for (const landmark of frame.landmarks) {
    byName.set(landmark.name, landmark);
  }

  // Check for missing or low-confidence landmarks
  let visibleCount = 0;
  let minSeenConfidence = 1;
  let hasMissing = false;

  for (const name of requiredLandmarks) {
    const landmark = byName.get(name);
    if (!landmark) {
      hasMissing = true;
      break;
    }
    if (landmark.confidence < minConfidence) {
      hasMissing = true;
      break;
    }
    visibleCount += 1;
    if (landmark.confidence < minSeenConfidence) {
      minSeenConfidence = landmark.confidence;
    }
  }

  if (hasMissing) {
    return {
      issue: 'partial_body',
      guidance: GUIDANCE.partial_body,
      metrics: {
        visibleLandmarkCount: visibleCount,
        requiredLandmarkCount: requiredLandmarks.length,
        minConfidence: minSeenConfidence,
        bodyFillRatio: null,
      },
    };
  }

  // Check coordinates are within valid range
  const imageWidth = frame.imageWidth ?? 0;
  const imageHeight = frame.imageHeight ?? 0;
  if (imageWidth > 0 && imageHeight > 0) {
    const pointsOutOfFrame = requiredLandmarks.some((name) => {
      const lm = byName.get(name)!;
      return lm.x < 0 || lm.y < 0 || lm.x > imageWidth || lm.y > imageHeight;
    });
    if (pointsOutOfFrame) {
      return {
        issue: 'out_of_frame',
        guidance: GUIDANCE.out_of_frame,
        metrics: {
          visibleLandmarkCount: visibleCount,
          requiredLandmarkCount: requiredLandmarks.length,
          minConfidence: minSeenConfidence,
          bodyFillRatio: null,
        },
      };
    }

    // Calculate body fill ratio
    const allPoints = requiredLandmarks.map((name) => byName.get(name)!);
    const minY = Math.min(...allPoints.map((p) => p.y));
    const maxY = Math.max(...allPoints.map((p) => p.y));
    const fillRatio = (maxY - minY) / imageHeight;

    if (fillRatio > 0.92) {
      return {
        issue: 'too_close',
        guidance: GUIDANCE.too_close,
        metrics: {
          visibleLandmarkCount: visibleCount,
          requiredLandmarkCount: requiredLandmarks.length,
          minConfidence: minSeenConfidence,
          bodyFillRatio: fillRatio,
        },
      };
    }

    if (fillRatio < 0.32) {
      return {
        issue: 'too_far',
        guidance: GUIDANCE.too_far,
        metrics: {
          visibleLandmarkCount: visibleCount,
          requiredLandmarkCount: requiredLandmarks.length,
          minConfidence: minSeenConfidence,
          bodyFillRatio: fillRatio,
        },
      };
    }
  }

  // All checks passed
  return {
    issue: 'ok',
    guidance: GUIDANCE.ok,
    metrics: {
      visibleLandmarkCount: visibleCount,
      requiredLandmarkCount: requiredLandmarks.length,
      minConfidence: minSeenConfidence,
      bodyFillRatio: null,
    },
  };
}
