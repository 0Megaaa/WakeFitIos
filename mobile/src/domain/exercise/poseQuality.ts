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

// Push-up requires upper body landmarks (no ankles required)
const PUSHUP_REQUIRED_LANDMARKS: Array<keyof RequiredBodyLandmarks | 'leftElbow' | 'rightElbow' | 'leftWrist' | 'rightWrist'> = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
];

// Body fill ratio thresholds
const MIN_BODY_FILL_RATIO = 0.32;
const MAX_BODY_FILL_RATIO = 0.92;

// Exercise-specific guidance
const SQUAT_GUIDANCE: Record<PoseQualityIssue, string> = {
  ok: '姿势标准，可以开始深蹲',
  partial_body: '请后退并确保头部、肩部、髋部、膝盖和脚踝全部入镜',
  low_confidence: '识别不稳定，请保持光线充足并站稳',
  out_of_frame: '请后退并确保头部、肩部、髋部、膝盖和脚踝全部入镜',
  too_close: '请后退一些，确保全身完整显示',
  too_far: '请靠近一些',
};

const PUSHUP_GUIDANCE: Record<PoseQualityIssue, string> = {
  ok: '姿势标准，可以开始俯卧撑',
  partial_body: '请确保头部、肩部、手臂和髋部全部入镜',
  low_confidence: '识别不稳定，请保持光线充足并站稳',
  out_of_frame: '请调整位置，确保上半身完整显示',
  too_close: '请后退一些，确保全身完整显示',
  too_far: '请靠近一些',
};

function getRequiredLandmarks(exerciseType: string): Array<string> {
  return exerciseType === 'squat' ? SQUAT_REQUIRED_LANDMARKS : PUSHUP_REQUIRED_LANDMARKS;
}

function getGuidance(issue: PoseQualityIssue, exerciseType: string): string {
  return exerciseType === 'squat' ? SQUAT_GUIDANCE[issue] : PUSHUP_GUIDANCE[issue];
}

/**
 * Evaluate pose quality and return guidance.
 * 
 * For Apple Vision squat exercise, bodyFillRatio checks are relaxed because:
 * - During squat, body naturally compresses (shoulder→ankle span decreases)
 * - This doesn't mean user is farther from camera
 * - too_far threshold is not enforced for apple-vision squat
 */
export function evaluatePoseQuality(
  frame: PoseFrame,
  options: { exerciseType?: string; minConfidence?: number } = {},
): PoseQualityResult {
  const exerciseType = options.exerciseType ?? 'squat';
  // Apple Vision requires lower confidence threshold for squat
  const isAppleVisionSquat = frame.source === 'apple-vision' && exerciseType === 'squat';
  const minConfidence = isAppleVisionSquat ? 0.35 : (options.minConfidence ?? 0.55);
  const requiredLandmarks = getRequiredLandmarks(exerciseType);

  const byName = new Map<string, { x: number; y: number; confidence: number }>();
  for (const landmark of frame.landmarks) {
    byName.set(landmark.name, landmark);
  }

  // Check for missing landmarks
  let visibleCount = 0;
  let hasMissing = false;
  let hasLowConfidence = false;
  let minSeenConfidence = 1;

  for (const name of requiredLandmarks) {
    const landmark = byName.get(name);
    if (!landmark) {
      hasMissing = true;
      break;
    }
    if (landmark.confidence < minConfidence) {
      hasLowConfidence = true;
      if (landmark.confidence < minSeenConfidence) {
        minSeenConfidence = landmark.confidence;
      }
    } else {
      visibleCount += 1;
      if (landmark.confidence < minSeenConfidence) {
        minSeenConfidence = landmark.confidence;
      }
    }
  }

  if (hasMissing) {
    return {
      issue: 'partial_body',
      guidance: getGuidance('partial_body', exerciseType),
      metrics: {
        visibleLandmarkCount: visibleCount,
        requiredLandmarkCount: requiredLandmarks.length,
        minConfidence: minSeenConfidence,
        bodyFillRatio: null,
      },
    };
  }

  if (hasLowConfidence) {
    return {
      issue: 'low_confidence',
      guidance: getGuidance('low_confidence', exerciseType),
      metrics: {
        visibleLandmarkCount: visibleCount,
        requiredLandmarkCount: requiredLandmarks.length,
        minConfidence: minSeenConfidence,
        bodyFillRatio: null,
      },
    };
  }

  // Check coordinates are within valid range
  if (frame.imageWidth > 0 && frame.imageHeight > 0) {
    const pointsOutOfFrame = requiredLandmarks.some((name) => {
      const lm = byName.get(name)!;
      return lm.x < 0 || lm.y < 0 || lm.x > frame.imageWidth || lm.y > frame.imageHeight;
    });
    if (pointsOutOfFrame) {
      return {
        issue: 'out_of_frame',
        guidance: getGuidance('out_of_frame', exerciseType),
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
    const fillRatio = (maxY - minY) / frame.imageHeight;

    if (fillRatio > MAX_BODY_FILL_RATIO) {
      return {
        issue: 'too_close',
        guidance: getGuidance('too_close', exerciseType),
        metrics: {
          visibleLandmarkCount: visibleCount,
          requiredLandmarkCount: requiredLandmarks.length,
          minConfidence: minSeenConfidence,
          bodyFillRatio: fillRatio,
        },
      };
    }

    // Apple Vision squat: skip too_far check during squat motion
    // Body naturally compresses during squat (shoulder→ankle span decreases)
    // This is geometric compression, not actual camera distance change
    if (fillRatio < MIN_BODY_FILL_RATIO && !isAppleVisionSquat) {
      return {
        issue: 'too_far',
        guidance: getGuidance('too_far', exerciseType),
        metrics: {
          visibleLandmarkCount: visibleCount,
          requiredLandmarkCount: requiredLandmarks.length,
          minConfidence: minSeenConfidence,
          bodyFillRatio: fillRatio,
        },
      };
    }

    // All checks passed - return actual bodyFillRatio
    return {
      issue: 'ok',
      guidance: getGuidance('ok', exerciseType),
      metrics: {
        visibleLandmarkCount: visibleCount,
        requiredLandmarkCount: requiredLandmarks.length,
        minConfidence: minSeenConfidence,
        bodyFillRatio: (maxY - minY) / frame.imageHeight,
      },
    };
  }

  // No image dimensions - all landmarks present with sufficient confidence
  return {
    issue: 'ok',
    guidance: getGuidance('ok', exerciseType),
    metrics: {
      visibleLandmarkCount: visibleCount,
      requiredLandmarkCount: requiredLandmarks.length,
      minConfidence: minSeenConfidence,
      bodyFillRatio: null,
    },
  };
}
