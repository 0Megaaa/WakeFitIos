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

// Apple Vision push-up relaxed settings
const APPLE_VISION_PUSHUP_MIN_CONFIDENCE = 0.35;

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
  ok: '手臂识别正常，可以开始俯卧撑',
  partial_body: '请调整位置，确保至少一侧肩部、手肘和手腕完整入镜',
  low_confidence: '识别不稳定，请保持肩部、手肘和手腕清晰入镜',
  out_of_frame: '请调整位置，确保手臂完整入镜',
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
 * Check if this is Apple Vision source
 */
function isAppleVision(frame: PoseFrame): boolean {
  return frame.source === 'apple-vision';
}

/**
 * Evaluate pose quality and return guidance.
 * 
 * Apple Vision push-up relaxations:
 * - Uses lower confidence threshold (0.35) for arm chain
 * - Only requires one arm side (shoulder + elbow + wrist) - no hip required
 * - Skips vertical bodyFillRatio too_far check (front/side view varies too much)
 * - Skips too_far threshold during push-up motion
 *
 * For Apple Vision squat exercise, bodyFillRatio checks are also relaxed because:
 * - During squat, body naturally compresses (shoulder→ankle span decreases)
 * - This doesn't mean user is farther from camera
 * - too_far threshold is not enforced for apple-vision squat
 */
export function evaluatePoseQuality(
  frame: PoseFrame,
  options: { exerciseType?: string; minConfidence?: number } = {},
): PoseQualityResult {
  const exerciseType = options.exerciseType ?? 'squat';
  const isAppleVisionSquat = isAppleVision(frame) && exerciseType === 'squat';
  const isAppleVisionPushup = isAppleVision(frame) && exerciseType === 'push_up';

  // Explicit configuration takes priority; otherwise use platform-specific defaults
  let minConfidence: number;
  if (options.minConfidence !== undefined) {
    minConfidence = options.minConfidence;
  } else if (isAppleVisionPushup) {
    minConfidence = APPLE_VISION_PUSHUP_MIN_CONFIDENCE;
  } else if (isAppleVisionSquat) {
    minConfidence = 0.35; // Apple Vision squat uses 0.35
  } else {
    minConfidence = 0.55; // ML Kit default
  }

  const requiredLandmarks = getRequiredLandmarks(exerciseType);

  const byName = new Map<string, { x: number; y: number; confidence: number }>();
  for (const landmark of frame.landmarks) {
    byName.set(landmark.name, landmark);
  }

  // Special handling for Apple Vision push-up: only need one arm side
  if (isAppleVisionPushup) {
    return evaluateAppleVisionPushupQuality(frame, byName, minConfidence);
  }

  // Standard evaluation for squat and ML Kit push-up
  return evaluateStandardQuality(frame, byName, requiredLandmarks, minConfidence, exerciseType);
}

/**
 * Apple Vision push-up quality evaluation.
 * Only requires one arm side (shoulder + elbow + wrist) with sufficient confidence.
 * No hip required, no vertical bodyFillRatio too_far check.
 */
function evaluateAppleVisionPushupQuality(
  frame: PoseFrame,
  byName: Map<string, { x: number; y: number; confidence: number }>,
  minConfidence: number,
): PoseQualityResult {
  // Check for valid arm chain on either side
  let leftArmValid = false;
  let rightArmValid = false;
  let leftMinConfidence = 1;
  let rightMinConfidence = 1;

  // Check left arm
  const leftShoulder = byName.get('leftShoulder');
  const leftElbow = byName.get('leftElbow');
  const leftWrist = byName.get('leftWrist');

  if (leftShoulder && leftElbow && leftWrist) {
    const minLeftConf = Math.min(leftShoulder.confidence, leftElbow.confidence, leftWrist.confidence);
    if (minLeftConf >= minConfidence) {
      leftArmValid = true;
      leftMinConfidence = minLeftConf;
    } else if (minLeftConf > 0) {
      leftMinConfidence = minLeftConf;
    }
  }

  // Check right arm
  const rightShoulder = byName.get('rightShoulder');
  const rightElbow = byName.get('rightElbow');
  const rightWrist = byName.get('rightWrist');

  if (rightShoulder && rightElbow && rightWrist) {
    const minRightConf = Math.min(rightShoulder.confidence, rightElbow.confidence, rightWrist.confidence);
    if (minRightConf >= minConfidence) {
      rightArmValid = true;
      rightMinConfidence = minRightConf;
    } else if (minRightConf > 0) {
      rightMinConfidence = minRightConf;
    }
  }

  // Determine issue based on arm availability
  if (!leftArmValid && !rightArmValid) {
    // Neither arm has all three points with sufficient confidence
    // Check if landmarks exist but have low confidence (vs. missing entirely)
    const hasLeftArmPoints = leftShoulder && leftElbow && leftWrist;
    const hasRightArmPoints = rightShoulder && rightElbow && rightWrist;

    // If both sides have complete landmark sets but low confidence
    if (hasLeftArmPoints && hasRightArmPoints) {
      const minLeftConf = Math.min(leftShoulder!.confidence, leftElbow!.confidence, leftWrist!.confidence);
      const minRightConf = Math.min(rightShoulder!.confidence, rightElbow!.confidence, rightWrist!.confidence);
      const overallMinConf = Math.min(minLeftConf, minRightConf);

      return {
        issue: 'low_confidence',
        guidance: getGuidance('low_confidence', 'push_up'),
        metrics: {
          visibleLandmarkCount: 6,
          requiredLandmarkCount: 6,
          minConfidence: overallMinConf,
          bodyFillRatio: null,
        },
      };
    }

    // If only one side has complete landmark set but low confidence
    if (hasLeftArmPoints || hasRightArmPoints) {
      const shoulder = hasLeftArmPoints ? leftShoulder! : rightShoulder!;
      const elbow = hasLeftArmPoints ? leftElbow! : rightElbow!;
      const wrist = hasLeftArmPoints ? leftWrist! : rightWrist!;
      const minConf = Math.min(shoulder.confidence, elbow.confidence, wrist.confidence);

      return {
        issue: 'low_confidence',
        guidance: getGuidance('low_confidence', 'push_up'),
        metrics: {
          visibleLandmarkCount: 3,
          requiredLandmarkCount: 6,
          minConfidence: minConf,
          bodyFillRatio: null,
        },
      };
    }

    // Some arm points visible but not complete - partial body
    const hasAnyArm = leftShoulder || leftElbow || leftWrist || rightShoulder || rightElbow || rightWrist;

    if (!hasAnyArm) {
      // No arm landmarks at all
      return {
        issue: 'partial_body',
        guidance: getGuidance('partial_body', 'push_up'),
        metrics: {
          visibleLandmarkCount: 0,
          requiredLandmarkCount: 6,
          minConfidence: 1,
          bodyFillRatio: null,
        },
      };
    }

    // Some arm points visible but not a complete side
    const visibleCount =
      (leftShoulder ? 1 : 0) + (leftElbow ? 1 : 0) + (leftWrist ? 1 : 0) +
      (rightShoulder ? 1 : 0) + (rightElbow ? 1 : 0) + (rightWrist ? 1 : 0);

    const minSeenConfidence = Math.min(
      leftMinConfidence < 1 ? leftMinConfidence : 1,
      rightMinConfidence < 1 ? rightMinConfidence : 1,
    );

    return {
      issue: 'partial_body',
      guidance: getGuidance('partial_body', 'push_up'),
      metrics: {
        visibleLandmarkCount: visibleCount,
        requiredLandmarkCount: 6,
        minConfidence: minSeenConfidence,
        bodyFillRatio: null,
      },
    };
  }

  // At least one arm is valid - calculate coordinates
  const armPoints: Array<{ x: number; y: number }> = [];
  if (leftArmValid && leftShoulder && leftElbow && leftWrist) {
    armPoints.push(leftShoulder, leftElbow, leftWrist);
  }
  if (rightArmValid && rightShoulder && rightElbow && rightWrist) {
    armPoints.push(rightShoulder, rightElbow, rightWrist);
  }

  // Check if points are out of frame
  if (frame.imageWidth > 0 && frame.imageHeight > 0) {
    const pointsOutOfFrame = armPoints.some(
      (p) => p.x < 0 || p.y < 0 || p.x > frame.imageWidth || p.y > frame.imageHeight,
    );

    if (pointsOutOfFrame) {
      return {
        issue: 'out_of_frame',
        guidance: getGuidance('out_of_frame', 'push_up'),
        metrics: {
          visibleLandmarkCount: armPoints.length,
          requiredLandmarkCount: 6,
          minConfidence: Math.min(leftArmValid ? leftMinConfidence : 1, rightArmValid ? rightMinConfidence : 1),
          bodyFillRatio: null,
        },
      };
    }

    // Calculate body fill ratio using arm points
    const minY = Math.min(...armPoints.map((p) => p.y));
    const maxY = Math.max(...armPoints.map((p) => p.y));
    const fillRatio = (maxY - minY) / frame.imageHeight;

    // Apple Vision push-up: skip too_close and too_far checks
    // Push-up can be performed at various distances, and front/side views
    // have very different vertical spans
    // The arm visibility is sufficient for push-up detection

    // All checks passed
    return {
      issue: 'ok',
      guidance: getGuidance('ok', 'push_up'),
      metrics: {
        visibleLandmarkCount: armPoints.length,
        requiredLandmarkCount: 6,
        minConfidence: Math.min(leftArmValid ? leftMinConfidence : 1, rightArmValid ? rightMinConfidence : 1),
        bodyFillRatio: fillRatio,
      },
    };
  }

  // No image dimensions - all landmarks present with sufficient confidence
  return {
    issue: 'ok',
    guidance: getGuidance('ok', 'push_up'),
    metrics: {
      visibleLandmarkCount: armPoints.length,
      requiredLandmarkCount: 6,
      minConfidence: Math.min(leftArmValid ? leftMinConfidence : 1, rightArmValid ? rightMinConfidence : 1),
      bodyFillRatio: null,
    },
  };
}

/**
 * Standard quality evaluation for squat and ML Kit push-up.
 * Requires all landmarks in the required set.
 */
function evaluateStandardQuality(
  frame: PoseFrame,
  byName: Map<string, { x: number; y: number; confidence: number }>,
  requiredLandmarks: Array<string>,
  minConfidence: number,
  exerciseType: string,
): PoseQualityResult {
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
    const isAppleVisionSquat = frame.source === 'apple-vision';
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
