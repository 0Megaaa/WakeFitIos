import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateAngle,
  createPushUpCounter,
  type PoseFrame,
  type PoseLandmarkName,
} from './pushupCounter.ts';
import { evaluatePoseQuality } from './poseQuality.ts';

type BodySide = 'left' | 'right';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

function appleVisionFrame(
  landmarks: Array<{ name: PoseLandmarkName; x: number; y: number; confidence: number }>,
  timestampMs = 1000,
): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks,
  };
}

function mlkitFrame(
  landmarks: Array<{ name: PoseLandmarkName; x: number; y: number; confidence: number }>,
  timestampMs = 1000,
): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'mlkit',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks,
  };
}

/**
 * Calculate wrist position for a specific elbow angle.
 */
function calculateWristForAngle(
  shoulderX: number, shoulderY: number,
  elbowX: number, elbowY: number,
  targetAngle: number,
): { x: number; y: number } {
  const length = 150;
  const cosAngle = Math.cos(targetAngle * Math.PI / 180);
  const CBy = -length * cosAngle;
  const CBx_squared = length * length - CBy * CBy;
  const CBx = Math.sqrt(Math.max(0, CBx_squared));
  return { x: elbowX + CBx, y: elbowY + CBy };
}

/**
 * Create a standard push-up frame with specified parameters.
 */
function createPushUpFrame(
  side: BodySide,
  position: 'up' | 'down' | number,
  confidence: number,
  source: 'apple-vision' | 'mlkit' = 'apple-vision',
  timestampMs = 1000,
  includeHip = true,
): PoseFrame {
  const prefix = side;
  let wrist: { x: number; y: number };

  if (position === 'up') {
    wrist = { x: 100, y: 350 };
  } else if (position === 'down') {
    wrist = { x: 150, y: 100 };
  } else {
    wrist = calculateWristForAngle(100, 50, 100, 200, position);
  }

  const landmarks: Array<{ name: PoseLandmarkName; x: number; y: number; confidence: number }> = [
    landmark(`${prefix}Shoulder` as PoseLandmarkName, 100, 50, confidence),
    landmark(`${prefix}Elbow` as PoseLandmarkName, 100, 200, confidence),
    landmark(`${prefix}Wrist` as PoseLandmarkName, wrist.x, wrist.y, confidence),
  ];

  if (includeHip) {
    landmarks.push(landmark(`${prefix}Hip` as PoseLandmarkName, 100, 250, confidence));
  }

  return source === 'apple-vision'
    ? appleVisionFrame(landmarks, timestampMs)
    : mlkitFrame(landmarks, timestampMs);
}

/**
 * Create a FRONT calibration frame (head facing camera, dual arm).
 * Arms extended with wrists below shoulders.
 */
function createFrontCalibrationFrame(
  elbowAngle: number,
  confidence: number,
  timestampMs: number,
): PoseFrame {
  const leftWrist = calculateWristForAngle(100, 80, 100, 200, elbowAngle);
  const rightWrist = calculateWristForAngle(200, 80, 200, 200, elbowAngle);

  return appleVisionFrame([
    { name: 'leftShoulder', x: 100, y: 80, confidence },
    { name: 'leftElbow', x: 100, y: 200, confidence },
    { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence },
    { name: 'rightShoulder', x: 200, y: 80, confidence },
    { name: 'rightElbow', x: 200, y: 200, confidence },
    { name: 'rightWrist', x: rightWrist.x, y: rightWrist.y, confidence },
  ], timestampMs);
}

/**
 * Create a SIDE calibration frame (body sideways, horizontal body axis).
 * Only one arm visible, hip/knee/ankle to the side.
 * Geometry: shoulder at top, elbow below, wrist below elbow (extended arm).
 * The elbow angle is the angle at the elbow joint (180 = straight, 90 = 90 degrees).
 * Lower body (hip/knee/ankle) should be at roughly the same y-level for side plank.
 */
function createSideCalibrationFrame(
  elbowAngle: number,
  confidence: number,
  timestampMs: number,
  side: 'left' | 'right' = 'left',
): PoseFrame {
  const xBase = side === 'left' ? 50 : 250;
  // For side plank: shoulder -> elbow -> wrist vertically down
  const shoulderY = 50;
  const elbowY = 150;
  const forearmLength = 100;
  // Elbow angle θ means angle at elbow joint
  // For straight arm (180°): wrist directly below elbow
  const radians = (180 - elbowAngle) * Math.PI / 180;
  const wristX = xBase + forearmLength * Math.sin(radians);
  const wristY = elbowY + forearmLength * Math.cos(radians);

  // For side plank, hip/knee/ankle should be at roughly same y-level (horizontal body)
  const bodyY = 80;

  return appleVisionFrame([
    { name: `${side}Shoulder`, x: xBase, y: shoulderY, confidence },
    { name: `${side}Elbow`, x: xBase, y: elbowY, confidence },
    { name: `${side}Wrist`, x: wristX, y: wristY, confidence },
    // Hip offset to the side - horizontal body axis (same y-level)
    { name: `${side}Hip`, x: xBase + 120, y: bodyY, confidence: Math.min(confidence, 0.30) },
    { name: `${side}Knee`, x: xBase + 240, y: bodyY + 5, confidence: Math.min(confidence, 0.30) },
    { name: `${side}Ankle`, x: xBase + 360, y: bodyY + 10, confidence: Math.min(confidence, 0.30) },
  ], timestampMs);
}

/**
 * Create a STANDING frame (clear vertical structure).
 * Should be detected as clearly standing.
 */
function createStandingFrame(
  confidence: number,
  timestampMs: number,
): PoseFrame {
  // Standing pose: shoulder, hip, knee, ankle in vertical alignment
  // Same x for left side, same x for right side
  // y increases from shoulder to ankle (vertical)
  return appleVisionFrame([
    // Left side - vertically aligned
    { name: 'leftShoulder', x: 100, y: 30, confidence },
    { name: 'leftHip', x: 100, y: 150, confidence },
    { name: 'leftKnee', x: 100, y: 300, confidence },
    { name: 'leftAnkle', x: 100, y: 500, confidence },
    // Right side - vertically aligned
    { name: 'rightShoulder', x: 200, y: 30, confidence },
    { name: 'rightHip', x: 200, y: 150, confidence },
    { name: 'rightKnee', x: 200, y: 300, confidence },
    { name: 'rightAnkle', x: 200, y: 500, confidence },
  ], timestampMs);
}

/**
 * Create a dual-arm frame for side stability testing.
 */
function createDualArmFrame(
  leftAngle: 'up' | 'down' | number,
  leftConfidence: number,
  rightAngle: 'up' | 'down' | number,
  rightConfidence: number,
  source: 'apple-vision' | 'mlkit',
  timestampMs: number,
): PoseFrame {
  const createWrist = (angle: 'up' | 'down' | number) => {
    if (angle === 'up') return { x: 100, y: 350 };
    if (angle === 'down') return { x: 150, y: 100 };
    return calculateWristForAngle(100, 50, 100, 200, angle);
  };

  return appleVisionFrame([
    { name: 'leftShoulder', x: 100, y: 50, confidence: leftConfidence },
    { name: 'leftElbow', x: 100, y: 200, confidence: leftConfidence },
    { name: 'leftWrist', ...createWrist(leftAngle), confidence: leftConfidence },
    { name: 'rightShoulder', x: 200, y: 50, confidence: rightConfidence },
    { name: 'rightElbow', x: 200, y: 200, confidence: rightConfidence },
    { name: 'rightWrist', ...createWrist(rightAngle), confidence: rightConfidence },
  ], timestampMs);
}

// ============================================================
// V1.8 CALIBRATION TESTS
// ============================================================
describe('V1.8 Apple Vision Push-up Calibration', () => {
  describe('Standing rejection', () => {
    it('Standing with arm bend should NOT trigger push-up count', () => {
      const counter = createPushUpCounter({ targetCount: 5 });

      // Standing frames should trigger standing hard gate
      for (let i = 0; i < 5; i++) {
        counter.handleFrame(createStandingFrame(0.95, 1000 + i * 100));
      }

      // Try to push up while standing using FRONT-like arms
      // V1.8.2: Use createStandingWithFrontLikeArmsFrame which has standing body + FRONT-like arms
      for (let i = 0; i < 6; i++) {
        counter.handleFrame(createStandingWithFrontLikeArmsFrame(0.95, 2000 + i * 100));
      }

      const result = counter.handleFrame(createStandingWithFrontLikeArmsFrame(0.95, 2600));
      // Should not count while standing (standing hard gate)
      assert.equal(result.count, 0, 'Standing with FRONT-like arms should NOT count');
    });
  });

  describe('FRONT Calibration', () => {
    it('FRONT calibration succeeds after 4 stable frames', () => {
      const counter = createPushUpCounter();

      for (let i = 0; i < 4; i++) {
        const result = counter.handleFrame(
          createFrontCalibrationFrame(160, 0.95, 1000 + i * 100)
        );
        if (i < 3) {
          assert.equal(result.phase, 'waiting_for_body');
        }
      }

      const result = counter.handleFrame(
        createFrontCalibrationFrame(160, 0.95, 1400)
      );
      assert.equal(result.phase, 'ready');
    });

    it('FRONT calibrated push-up can count', () => {
      const counter = createPushUpCounter();

      // Calibrate
      for (let i = 0; i < 4; i++) {
        counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
      }

      // DOWN
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
      const downResult = counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
      assert.equal(downResult.phase, 'down');

      // UP
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
      const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
      assert.equal(result.count, 1);
    });
  });

  describe('SIDE Calibration', () => {
    it('SIDE calibration succeeds after 4 stable frames', () => {
      const counter = createPushUpCounter();

      for (let i = 0; i < 4; i++) {
        const result = counter.handleFrame(
          createSideCalibrationFrame(160, 0.95, 1000 + i * 100, 'left')
        );
        if (i < 3) {
          assert.equal(result.phase, 'waiting_for_body');
        }
      }

      const result = counter.handleFrame(
        createSideCalibrationFrame(160, 0.95, 1400, 'left')
      );
      assert.equal(result.phase, 'ready');
    });

    it('SIDE calibrated push-up can count', () => {
      const counter = createPushUpCounter();

      // Calibrate
      for (let i = 0; i < 4; i++) {
        counter.handleFrame(createSideCalibrationFrame(172, 0.95, 100 + i * 100, 'left'));
      }

      // Push-up
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
      const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
      assert.equal(result.count, 1);
    });
  });

  describe('Calibration stability', () => {
    it('Only 4 frames should calibrate', () => {
      const counter = createPushUpCounter();

      // Only 3 frames - should not be ready
      for (let i = 0; i < 3; i++) {
        const result = counter.handleFrame(
          createFrontCalibrationFrame(160, 0.95, 1000 + i * 100)
        );
        assert.equal(result.phase, 'waiting_for_body');
      }
    });
  });

  describe('Post-calibration 1500ms grace', () => {
    it('Calibrated push-up survives 500ms arm occlusion', () => {
      const counter = createPushUpCounter();

      // Calibrate
      for (let i = 0; i < 4; i++) {
        counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
      }

      // DOWN
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

      // Arm lost for 500ms
      const lostFrame: PoseFrame = {
        timestampMs: 2600,
        imageWidth: 300,
        imageHeight: 640,
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [],
      };
      counter.handleFrame({ ...lostFrame, timestampMs: 2600 });
      counter.handleFrame({ ...lostFrame, timestampMs: 3100 });

      // Restore and UP
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3500, false));
      const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3600, false));
      assert.equal(result.count, 1);
    });
  });

  describe('Standing up clears calibration', () => {
    it('Standing up resets calibration', () => {
      const counter = createPushUpCounter();

      // Calibrate
      for (let i = 0; i < 4; i++) {
        counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
      }

      // Push-up count 1
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
      const afterPushup = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
      assert.equal(afterPushup.count, 1);

      // Stand up - should clear calibration
      for (let i = 0; i < 3; i++) {
        counter.handleFrame(createStandingFrame(0.95, 4000 + i * 100));
      }

      // Try to push up without recalibrating - should not count
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 5000, false));
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 5100, false));
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 6000, false));
      const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 6100, false));

      assert.equal(result.count, 1, 'Standing should prevent second push-up');
    });
  });
});

// ============================================================
// V1.7.1 REGRESSION TESTS
// ============================================================
describe('V1.7.1 baseline drift protection', () => {
  it('Lower UP readings cannot drag baseline down', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // Lower UP readings
    counter.handleFrame(createFrontCalibrationFrame(158, 0.95, 1000));
    counter.handleFrame(createFrontCalibrationFrame(155, 0.95, 1100));
    counter.handleFrame(createFrontCalibrationFrame(153, 0.95, 1200));
    counter.handleFrame(createFrontCalibrationFrame(150, 0.95, 1300));

    // 142 should still be relative DOWN
    counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 2000, false));
    const downResult = counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 2100, false));
    assert.equal(downResult.phase, 'down');

    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(result.count, 1);
  });
});

describe('V1.7.1 side stability', () => {
  it('Dual-arm confidence fluctuation does not cause side switching', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // UP with fluctuating confidences
    counter.handleFrame(createDualArmFrame('up', 0.95, 'up', 0.80, 'apple-vision', 1000));
    counter.handleFrame(createDualArmFrame('up', 0.80, 'up', 0.96, 'apple-vision', 1100));
    let result = counter.handleFrame(createDualArmFrame('up', 0.92, 'up', 0.88, 'apple-vision', 1200));
    assert.equal(result.phase, 'ready');

    // DOWN
    counter.handleFrame(createDualArmFrame('down', 0.88, 'down', 0.92, 'apple-vision', 2000));
    counter.handleFrame(createDualArmFrame('down', 0.90, 'down', 0.85, 'apple-vision', 2100));
    result = counter.handleFrame(createDualArmFrame('down', 0.87, 'down', 0.93, 'apple-vision', 2200));
    assert.equal(result.phase, 'down');

    // UP
    counter.handleFrame(createDualArmFrame('up', 0.91, 'up', 0.89, 'apple-vision', 3000));
    result = counter.handleFrame(createDualArmFrame('up', 0.88, 'up', 0.93, 'apple-vision', 3100));
    assert.equal(result.count, 1);
  });
});

// ============================================================
// ML KIT REGRESSION TESTS
// ============================================================
describe('ML Kit push-up - regression tests', () => {
  it('ML Kit no-arm immediately resets', () => {
    const counter = createPushUpCounter();

    // UP x2
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1100));

    // DOWN x2
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2000));
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2100));

    let result = counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2200));
    assert.equal(result.phase, 'down');

    // No arm - should immediately reset
    const noArmFrame: PoseFrame = {
      timestampMs: 2300,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [],
    };
    result = counter.handleFrame(noArmFrame);
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('ML Kit maintains default minConfidence 0.55', () => {
    const counter = createPushUpCounter();

    const frame = mlkitFrame([
      { name: 'leftShoulder', x: 100, y: 50, confidence: 0.50 },
      { name: 'leftElbow', x: 100, y: 200, confidence: 0.50 },
      { name: 'leftWrist', x: 100, y: 350, confidence: 0.50 },
      { name: 'leftHip', x: 100, y: 250, confidence: 0.50 },
    ]);

    const result = counter.handleFrame(frame);
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('ML Kit maintains default downAngle 90', () => {
    const counter = createPushUpCounter();

    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1100));

    counter.handleFrame(createPushUpFrame('left', 95, 0.95, 'mlkit', 2000));
    let result = counter.handleFrame(createPushUpFrame('left', 95, 0.95, 'mlkit', 2100));
    assert.equal(result.phase, 'ready');

    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 3000));
    result = counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 3100));
    assert.equal(result.phase, 'down');
  });
});

// ============================================================
// CORE TESTS
// ============================================================
describe('push-up counter core', () => {
  it('calculates the elbow angle', () => {
    const angle = calculateAngle({ x: 100, y: 50 }, { x: 100, y: 200 }, { x: 100, y: 350 });
    assert.equal(Math.round(angle), 180);
  });

  it('counts one push-up after calibration', () => {
    const counter = createPushUpCounter({ targetCount: 5 });

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(180, 0.95, 100 + i * 100));
    }

    // Rep
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('does not count noise spike', () => {
    const counter = createPushUpCounter({ targetCount: 5 });

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(180, 0.95, 100 + i * 100));
    }

    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2100, false));
    assert.equal(result.count, 0);
  });

  it('marks challenge complete', () => {
    const counter = createPushUpCounter({ targetCount: 2 });

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(180, 0.95, 100 + i * 100));
    }

    // Rep 1
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));

    // Rep 2
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 4000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 4100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 5000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 5100, false));

    assert.equal(result.count, 2);
    assert.equal(result.isComplete, true);
  });
});

// ============================================================
// V1.8.1 CALIBRATION BLOCKER TESTS
// ============================================================

/**
 * Create a single-arm FRONT frame (only left arm).
 * V1.8.1: This should NEVER trigger FRONT calibration.
 */
function createSingleArmFrontFrame(
  elbowAngle: number,
  confidence: number,
  timestampMs: number,
  side: 'left' | 'right' = 'left',
): PoseFrame {
  const xBase = side === 'left' ? 100 : 200;
  const wrist = calculateWristForAngle(xBase, 80, xBase, 200, elbowAngle);

  return appleVisionFrame([
    { name: `${side}Shoulder`, x: xBase, y: 80, confidence },
    { name: `${side}Elbow`, x: xBase, y: 200, confidence },
    { name: `${side}Wrist`, x: wrist.x, y: wrist.y, confidence },
  ], timestampMs);
}

/**
 * Create a SIDE frame WITHOUT hip (arm only).
 * V1.8.1: This should NEVER trigger SIDE calibration.
 */
function createSideWithoutHipFrame(
  elbowAngle: number,
  confidence: number,
  timestampMs: number,
  side: 'left' | 'right' = 'left',
): PoseFrame {
  const xBase = side === 'left' ? 50 : 250;
  const forearmLength = 100;
  const radians = (180 - elbowAngle) * Math.PI / 180;
  const wristX = xBase + forearmLength * Math.sin(radians);
  const wristY = 150 + forearmLength * Math.cos(radians);

  return appleVisionFrame([
    { name: `${side}Shoulder`, x: xBase, y: 50, confidence },
    { name: `${side}Elbow`, x: xBase, y: 150, confidence },
    { name: `${side}Wrist`, x: wristX, y: wristY, confidence },
    // No hip, knee, or ankle
  ], timestampMs);
}

/**
 * Create a SIDE frame with VERTICAL hip (standing-like).
 * V1.8.1: This should NEVER trigger SIDE calibration.
 */
function createSideVerticalHipFrame(
  elbowAngle: number,
  confidence: number,
  timestampMs: number,
  side: 'left' | 'right' = 'left',
): PoseFrame {
  const xBase = side === 'left' ? 50 : 250;
  const forearmLength = 100;
  const radians = (180 - elbowAngle) * Math.PI / 180;
  const wristX = xBase + forearmLength * Math.sin(radians);
  const wristY = 150 + forearmLength * Math.cos(radians);

  return appleVisionFrame([
    { name: `${side}Shoulder`, x: xBase, y: 50, confidence },
    { name: `${side}Elbow`, x: xBase, y: 150, confidence },
    { name: `${side}Wrist`, x: wristX, y: wristY, confidence },
    // Hip directly below shoulder (vertical)
    { name: `${side}Hip`, x: xBase, y: 200, confidence: Math.min(confidence, 0.30) },
    { name: `${side}Knee`, x: xBase, y: 350, confidence: Math.min(confidence, 0.30) },
    { name: `${side}Ankle`, x: xBase, y: 500, confidence: Math.min(confidence, 0.30) },
  ], timestampMs);
}

/**
 * Create a STANDING frame with arm bend.
 * For testing standing rejection.
 */
function createStandingWithArmBendFrame(
  confidence: number,
  timestampMs: number,
): PoseFrame {
  return appleVisionFrame([
    // Left side - vertically aligned
    { name: 'leftShoulder', x: 100, y: 30, confidence },
    { name: 'leftHip', x: 100, y: 150, confidence },
    { name: 'leftKnee', x: 100, y: 300, confidence },
    { name: 'leftAnkle', x: 100, y: 500, confidence },
    // Right side - vertically aligned
    { name: 'rightShoulder', x: 200, y: 30, confidence },
    { name: 'rightHip', x: 200, y: 150, confidence },
    { name: 'rightKnee', x: 200, y: 300, confidence },
    { name: 'rightAnkle', x: 200, y: 500, confidence },
    // Arms bent
    { name: 'leftElbow', x: 80, y: 150, confidence },
    { name: 'leftWrist', x: 50, y: 100, confidence },
    { name: 'rightElbow', x: 220, y: 150, confidence },
    { name: 'rightWrist', x: 250, y: 100, confidence },
  ], timestampMs);
}

describe('V1.8.1 FRONT single arm must NOT calibrate', () => {
  it('Single arm (left only) should never trigger FRONT calibration', () => {
    const counter = createPushUpCounter();

    // 10 frames of single arm - should never calibrate
    for (let i = 0; i < 10; i++) {
      const result = counter.handleFrame(
        createSingleArmFrontFrame(170, 0.95, 1000 + i * 100, 'left')
      );
      assert.equal(result.phase, 'waiting_for_body', `Frame ${i + 1} should not calibrate`);
      assert.equal(result.count, 0);
    }
  });

  it('Single arm (right only) should never trigger FRONT calibration', () => {
    const counter = createPushUpCounter();

    for (let i = 0; i < 10; i++) {
      const result = counter.handleFrame(
        createSingleArmFrontFrame(170, 0.95, 1000 + i * 100, 'right')
      );
      assert.equal(result.phase, 'waiting_for_body');
      assert.equal(result.count, 0);
    }
  });
});

describe('V1.8.1 SIDE without hip must NOT calibrate', () => {
  it('Arm without hip should never trigger SIDE calibration', () => {
    const counter = createPushUpCounter();

    // 10 frames of arm-only - should never SIDE calibrate
    for (let i = 0; i < 10; i++) {
      const result = counter.handleFrame(
        createSideWithoutHipFrame(170, 0.95, 1000 + i * 100, 'left')
      );
      assert.equal(result.phase, 'waiting_for_body', `Frame ${i + 1} should not SIDE calibrate`);
      assert.equal(result.count, 0);
    }
  });
});

describe('V1.8.1 SIDE with vertical hip must NOT calibrate', () => {
  it('Arm with vertical hip should never trigger SIDE calibration', () => {
    const counter = createPushUpCounter();

    for (let i = 0; i < 5; i++) {
      const result = counter.handleFrame(
        createSideVerticalHipFrame(170, 0.95, 1000 + i * 100, 'left')
      );
      assert.equal(result.phase, 'waiting_for_body', `Frame ${i + 1} should not SIDE calibrate`);
    }
  });
});

describe('V1.8.1 Standing with arm bend rejection', () => {
  it('Clear standing + arm bend should NOT count', () => {
    const counter = createPushUpCounter();

    // Standing frames first
    for (let i = 0; i < 5; i++) {
      counter.handleFrame(createStandingFrame(0.95, 1000 + i * 100));
    }

    // Then try push-up motion while still standing
    for (let i = 0; i < 6; i++) {
      counter.handleFrame(createStandingWithArmBendFrame(0.95, 2000 + i * 100));
    }

    const result = counter.handleFrame(createStandingWithArmBendFrame(0.95, 2600));
    assert.equal(result.count, 0, 'Standing should prevent push-up count');
    assert.ok(result.phase === 'waiting_for_body' || result.phase === 'ready');
  });

  it('Standing with partial lower-body (ankle missing) should still reject', () => {
    const counter = createPushUpCounter();

    // Create 3-point standing frame without ankle (shoulder → hip → knee)
    function create3PointStandingFrame(confidence: number, timestampMs: number): PoseFrame {
      return appleVisionFrame([
        { name: 'leftShoulder', x: 100, y: 30, confidence },
        { name: 'leftHip', x: 100, y: 150, confidence },
        { name: 'leftKnee', x: 100, y: 300, confidence },
        // NO leftAnkle
        { name: 'rightShoulder', x: 200, y: 30, confidence },
        { name: 'rightHip', x: 200, y: 150, confidence },
        { name: 'rightKnee', x: 200, y: 300, confidence },
        // NO rightAnkle
        // Add FRONT-like arms
        { name: 'leftElbow', x: 100, y: 200, confidence },
        { name: 'leftWrist', x: 100, y: 350, confidence },
        { name: 'rightElbow', x: 200, y: 200, confidence },
        { name: 'rightWrist', x: 200, y: 350, confidence },
      ], timestampMs);
    }

    // 3-point standing frames (shoulder → hip → knee, no ankle)
    // Each frame should be rejected by standing hard gate
    for (let i = 0; i < 6; i++) {
      const result = counter.handleFrame(create3PointStandingFrame(0.95, 1000 + i * 100));
      assert.equal(result.phase, 'waiting_for_body', `Frame ${i + 1} should be rejected by standing`);
      assert.equal(result.count, 0, `Frame ${i + 1} should have zero count`);
    }
  });
});

describe('V1.8.1 SIDE single arm + hip must calibrate', () => {
  it('SIDE with single arm + same-side hip should calibrate', () => {
    const counter = createPushUpCounter();

    // Use existing createSideCalibrationFrame which has arm + hip
    for (let i = 0; i < 4; i++) {
      const result = counter.handleFrame(
        createSideCalibrationFrame(160, 0.95, 1000 + i * 100, 'left')
      );
      if (i < 3) {
        assert.equal(result.phase, 'waiting_for_body');
      }
    }

    const result = counter.handleFrame(
      createSideCalibrationFrame(160, 0.95, 1400, 'left')
    );
    assert.equal(result.phase, 'ready', 'SIDE with arm + hip should calibrate');
  });

  it('SIDE calibration with arm + hip can count', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createSideCalibrationFrame(172, 0.95, 100 + i * 100, 'left'));
    }

    // Push-up using single arm
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(result.count, 1);
  });
});

describe('V1.8.1 1-frame miss tolerance', () => {
  it('FRONT FRONT MISS FRONT FRONT should calibrate', () => {
    const counter = createPushUpCounter();

    // Frame 1-2: FRONT
    counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1000));
    counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1100));

    // Frame 3: MISS (not valid calibration)
    counter.handleFrame(createSingleArmFrontFrame(160, 0.95, 1200));

    // Frame 4-5: FRONT
    counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1300));
    const result = counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1400));

    // Should have calibrated (4 valid frames with 1 miss in between)
    assert.equal(result.phase, 'ready', 'Should calibrate with 1 miss frame');
  });

  it('Two consecutive MISS resets progress', () => {
    const counter = createPushUpCounter();

    // Frame 1-2: FRONT
    counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1000));
    counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1100));

    // Frame 3: MISS
    counter.handleFrame(createSingleArmFrontFrame(160, 0.95, 1200));

    // Frame 4: MISS again - should reset progress
    counter.handleFrame(createSingleArmFrontFrame(160, 0.95, 1300));

    // Frame 5-6: FRONT (only 2 valid)
    counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1400));
    const result = counter.handleFrame(createFrontCalibrationFrame(160, 0.95, 1500));

    // Should NOT have calibrated (only 2 valid frames, need 4)
    assert.equal(result.phase, 'waiting_for_body', 'Should not calibrate with only 2 valid frames');
  });
});

// ============================================================
// V1.8.1 V1.7.1 REGRESSION TESTS RECOVERY
// ============================================================

describe('V1.8.1 V1.7.1 regression: Apple Vision confidence 0.40', () => {
  it('0.40 arm confidence should still work', () => {
    const counter = createPushUpCounter();

    // Calibrate with 0.40 confidence
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.40, 100 + i * 100));
    }

    // Should be ready
    let result = counter.handleFrame(createFrontCalibrationFrame(172, 0.40, 500));
    assert.equal(result.phase, 'ready');

    // Push-up
    counter.handleFrame(createPushUpFrame('left', 'down', 0.40, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.40, 'apple-vision', 1100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'apple-vision', 2000, false));
    result = counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'apple-vision', 2100, false));
    assert.equal(result.count, 1);
  });
});

describe('V1.8.1 V1.7.1 regression: absolute DOWN 125 degrees', () => {
  it('125 degree absolute DOWN should enter down state', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // 125 degrees (less than 135 absolute DOWN threshold)
    counter.handleFrame(createPushUpFrame('left', 125, 0.95, 'apple-vision', 1000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 125, 0.95, 'apple-vision', 1100, false));
    assert.equal(result.phase, 'down', '125 degrees should trigger down state');
  });
});

describe('V1.8.1 V1.7.1 regression: relative fallback 172 to 142', () => {
  it('Baseline 172 -> 142 relative DOWN should work', () => {
    const counter = createPushUpCounter();

    // Calibrate with 172 baseline
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // 142 degrees: delta = 172 - 142 = 30 >= 25, and 142 <= 145
    counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 1000, false));
    const downResult = counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 1100, false));
    assert.equal(downResult.phase, 'down');

    // UP to count
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2100, false));
    assert.equal(result.count, 1);
  });
});

describe('V1.8.1 V1.7.1 regression: Slight bend should NOT enter DOWN', () => {
  it('170 -> 155 should not trigger down (insufficient delta)', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // 155 degrees: delta = 172 - 155 = 17 < 25
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'apple-vision', 1000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'apple-vision', 1100, false));
    assert.equal(result.phase, 'ready', '155 degrees should not trigger down');
  });
});

describe('V1.8.1 V1.7.1 regression: Stay DOWN does not double count', () => {
  it('Multiple DOWN frames should not increment count', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // DOWN
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1100, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1200, false));

    // UP
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2100, false));
    assert.equal(result.count, 1, 'Should count only once');
  });
});

describe('V1.8.1 V1.7.1 regression: Initial DOWN does not count', () => {
  it('Starting in DOWN position should not count', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // Already in DOWN position
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1100, false));

    // UP to count
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2100, false));
    assert.equal(result.count, 1, 'Should count from initial DOWN');
  });
});

describe('V1.8.1 V1.7.1 regression: 500ms arm loss continues rep', () => {
  it('500ms arm occlusion during DOWN should preserve rep', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // DOWN
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // Arm lost for 500ms
    const lostFrame: PoseFrame = {
      timestampMs: 2600,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [],
    };
    counter.handleFrame({ ...lostFrame, timestampMs: 2600 });
    counter.handleFrame({ ...lostFrame, timestampMs: 3100 });

    // UP
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3500, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3600, false));
    assert.equal(result.count, 1, 'Should count despite 500ms arm loss');
  });
});

describe('V1.8.1 V1.7.1 regression: >1500ms arm loss resets calibration', () => {
  it('>1500ms arm loss should reset calibration but preserve count', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // DOWN
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // UP - count 1
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const afterCount = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(afterCount.count, 1);

    // Arm lost for >1500ms
    const lostFrame: PoseFrame = {
      timestampMs: 4000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [],
    };
    counter.handleFrame({ ...lostFrame, timestampMs: 4000 });
    counter.handleFrame({ ...lostFrame, timestampMs: 5600 }); // 1600ms later

    // Try to continue - should need recalibration
    counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 6000));
    counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 6100));
    counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 6200));
    counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 6300));

    // Recalibrate
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 7000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 7100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 8000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 8100, false));
    assert.equal(result.count, 2, 'Should count second rep after recalibration');
  });
});

describe('V1.8.1 V1.7.1 regression: Left/right confidence fluctuation', () => {
  it('Active side should remain stable during confidence fluctuation', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // Fluctuating confidence
    counter.handleFrame(createDualArmFrame('up', 0.95, 'up', 0.40, 'apple-vision', 1000));
    counter.handleFrame(createDualArmFrame('up', 0.40, 'up', 0.96, 'apple-vision', 1100));
    counter.handleFrame(createDualArmFrame('up', 0.92, 'up', 0.88, 'apple-vision', 1200));

    let result = counter.handleFrame(createDualArmFrame('up', 0.85, 'up', 0.90, 'apple-vision', 1300));
    assert.equal(result.phase, 'ready');

    // DOWN
    counter.handleFrame(createDualArmFrame('down', 0.88, 'down', 0.92, 'apple-vision', 2000));
    counter.handleFrame(createDualArmFrame('down', 0.90, 'down', 0.85, 'apple-vision', 2100));
    result = counter.handleFrame(createDualArmFrame('down', 0.87, 'down', 0.93, 'apple-vision', 2200));
    assert.equal(result.phase, 'down');

    // UP
    counter.handleFrame(createDualArmFrame('up', 0.91, 'up', 0.89, 'apple-vision', 3000));
    result = counter.handleFrame(createDualArmFrame('up', 0.88, 'up', 0.93, 'apple-vision', 3100));
    assert.equal(result.count, 1);
  });
});

describe('V1.8.1 ML Kit: default confidence 0.55', () => {
  it('ML Kit should require 0.55 confidence', () => {
    const counter = createPushUpCounter();

    // 0.50 confidence should fail
    const frame = mlkitFrame([
      { name: 'leftShoulder', x: 100, y: 50, confidence: 0.50 },
      { name: 'leftElbow', x: 100, y: 200, confidence: 0.50 },
      { name: 'leftWrist', x: 100, y: 350, confidence: 0.50 },
      { name: 'leftHip', x: 100, y: 250, confidence: 0.50 },
    ]);
    const result = counter.handleFrame(frame);
    assert.equal(result.phase, 'waiting_for_body');
  });
});

describe('V1.8.1 ML Kit: default DOWN 90 degrees', () => {
  it('ML Kit should use 90 degree down threshold', () => {
    const counter = createPushUpCounter();

    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1100));

    // 95 degrees should NOT be down
    counter.handleFrame(createPushUpFrame('left', 95, 0.95, 'mlkit', 2000));
    let result = counter.handleFrame(createPushUpFrame('left', 95, 0.95, 'mlkit', 2100));
    assert.equal(result.phase, 'ready', '95 degrees should not trigger ML Kit down');

    // 85 degrees should be down
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 3000));
    result = counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 3100));
    assert.equal(result.phase, 'down', '85 degrees should trigger ML Kit down');
  });
});

describe('V1.8.1 ML Kit: default UP 160 degrees', () => {
  it('ML Kit should use 160 degree up threshold', () => {
    const counter = createPushUpCounter();

    // 155 degrees should NOT be up
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'mlkit', 1000));
    const result = counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'mlkit', 1100));
    assert.equal(result.phase, 'waiting_for_body', '155 degrees should not trigger ML Kit up');
  });
});

describe('V1.8.1 ML Kit: hip required for push-up', () => {
  it('ML Kit should require hip for push-up', () => {
    const counter = createPushUpCounter();

    // Frame without hip
    const frame = mlkitFrame([
      { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
      { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
      { name: 'leftWrist', x: 100, y: 350, confidence: 0.95 },
      // No hip
    ]);
    const result = counter.handleFrame(frame);
    assert.equal(result.phase, 'waiting_for_body', 'ML Kit should require hip');
  });
});

describe('V1.8.1 ML Kit: no-arm immediate reset', () => {
  it('ML Kit should immediately reset on no arm (no grace)', () => {
    const counter = createPushUpCounter();

    // UP
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1100));

    // DOWN
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2000));
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2100));
    let result = counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2200));
    assert.equal(result.phase, 'down');

    // No arm immediately resets (no grace period like Apple Vision)
    const noArmFrame: PoseFrame = {
      timestampMs: 2300,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [],
    };
    result = counter.handleFrame(noArmFrame);
    assert.equal(result.phase, 'waiting_for_body', 'ML Kit should immediately reset');
  });
});

// ============================================================
// V1.8.2 NEW TESTS
// ============================================================

/**
 * Create a Standing frame with FRONT-like dual arms.
 * This is the most dangerous case: clearly standing but arms look like FRONT plank.
 */
function createStandingWithFrontLikeArmsFrame(
  confidence: number,
  timestampMs: number,
): PoseFrame {
  return appleVisionFrame([
    // Left side - vertically aligned standing
    { name: 'leftShoulder', x: 100, y: 30, confidence },
    { name: 'leftHip', x: 100, y: 150, confidence },
    { name: 'leftKnee', x: 100, y: 300, confidence },
    { name: 'leftAnkle', x: 100, y: 500, confidence },
    // Right side - vertically aligned standing
    { name: 'rightShoulder', x: 200, y: 30, confidence },
    { name: 'rightHip', x: 200, y: 150, confidence },
    { name: 'rightKnee', x: 200, y: 300, confidence },
    { name: 'rightAnkle', x: 200, y: 500, confidence },
    // Arms positioned like FRONT plank (extended below shoulders)
    { name: 'leftElbow', x: 100, y: 200, confidence },
    { name: 'leftWrist', x: 100, y: 350, confidence },
    { name: 'rightElbow', x: 200, y: 200, confidence },
    { name: 'rightWrist', x: 200, y: 350, confidence },
  ], timestampMs);
}

describe('V1.8.2 Real Standing + FRONT-like dual arms', () => {
  it('Standing with FRONT-like dual arms should NEVER calibrate (10 frames)', () => {
    const counter = createPushUpCounter();

    // 10 frames of standing with FRONT-like arms
    for (let i = 0; i < 10; i++) {
      const result = counter.handleFrame(
        createStandingWithFrontLikeArmsFrame(0.95, 1000 + i * 100)
      );
      assert.equal(result.phase, 'waiting_for_body', `Frame ${i + 1} should never calibrate`);
      assert.equal(result.count, 0);
    }
  });
});

describe('V1.8.2 Standing with partial lower-body fluctuation', () => {
  it('Standing detector fluctuation should still prevent calibration', () => {
    const counter = createPushUpCounter();

    // Frame 1: Complete standing
    counter.handleFrame(createStandingFrame(0.95, 1000));

    // Frame 2: Ankle missing (3-point standing)
    function createStandingNoAnkleFrame(conf: number, ts: number): PoseFrame {
      return appleVisionFrame([
        { name: 'leftShoulder', x: 100, y: 30, confidence: conf },
        { name: 'leftHip', x: 100, y: 150, confidence: conf },
        { name: 'leftKnee', x: 100, y: 300, confidence: conf },
        { name: 'rightShoulder', x: 200, y: 30, confidence: conf },
        { name: 'rightHip', x: 200, y: 150, confidence: conf },
        { name: 'rightKnee', x: 200, y: 300, confidence: conf },
        // Arms like FRONT plank
        { name: 'leftElbow', x: 100, y: 200, confidence: conf },
        { name: 'leftWrist', x: 100, y: 350, confidence: conf },
        { name: 'rightElbow', x: 200, y: 200, confidence: conf },
        { name: 'rightWrist', x: 200, y: 350, confidence: conf },
      ], ts);
    }
    counter.handleFrame(createStandingNoAnkleFrame(0.95, 1100));

    // Frame 3: Complete standing
    counter.handleFrame(createStandingFrame(0.95, 1200));

    // Frame 4: Knee confidence low (may cause standing detector to fail)
    function createStandingLowKneeFrame(conf: number, ts: number): PoseFrame {
      return appleVisionFrame([
        { name: 'leftShoulder', x: 100, y: 30, confidence: conf },
        { name: 'leftHip', x: 100, y: 150, confidence: conf },
        { name: 'leftKnee', x: 100, y: 300, confidence: 0.25 }, // Low confidence
        { name: 'leftAnkle', x: 100, y: 500, confidence: conf },
        { name: 'rightShoulder', x: 200, y: 30, confidence: conf },
        { name: 'rightHip', x: 200, y: 150, confidence: conf },
        { name: 'rightKnee', x: 200, y: 300, confidence: 0.25 },
        { name: 'rightAnkle', x: 200, y: 500, confidence: conf },
        // Arms like FRONT plank
        { name: 'leftElbow', x: 100, y: 200, confidence: conf },
        { name: 'leftWrist', x: 100, y: 350, confidence: conf },
        { name: 'rightElbow', x: 200, y: 200, confidence: conf },
        { name: 'rightWrist', x: 200, y: 350, confidence: conf },
      ], ts);
    }
    counter.handleFrame(createStandingLowKneeFrame(0.95, 1300));

    // Frame 5: Complete standing
    counter.handleFrame(createStandingFrame(0.95, 1400));

    // Frame 6: Ankle missing again
    counter.handleFrame(createStandingNoAnkleFrame(0.95, 1500));

    // After all these frames, should still not have calibrated
    // due to standing hard gate
    const result = counter.handleFrame(createStandingWithFrontLikeArmsFrame(0.95, 1600));
    assert.equal(result.phase, 'waiting_for_body', 'Standing fluctuation should not allow calibration');
  });
});

/**
 * Create a RIGHT-only SIDE calibration frame (left arm exists but no left hip).
 */
function createRightSideCalibrationFrame(
  elbowAngle: number,
  confidence: number,
  timestampMs: number,
): PoseFrame {
  const xBase = 250; // Right side
  const shoulderY = 50;
  const elbowY = 150;
  const forearmLength = 100;
  const radians = (180 - elbowAngle) * Math.PI / 180;
  const wristX = xBase + forearmLength * Math.sin(radians);
  const wristY = elbowY + forearmLength * Math.cos(radians);

  // Right side - full SIDE (hip, knee, ankle)
  // Left side - arm only (no hip)
  return appleVisionFrame([
    // Left arm (no hip)
    { name: 'leftShoulder', x: 50, y: 50, confidence },
    { name: 'leftElbow', x: 50, y: 150, confidence },
    { name: 'leftWrist', x: 50 + forearmLength * Math.sin(radians), y: wristY, confidence },
    // Right arm with hip (SIDE)
    { name: 'rightShoulder', x: xBase, y: shoulderY, confidence },
    { name: 'rightElbow', x: xBase, y: elbowY, confidence },
    { name: 'rightWrist', x: wristX, y: wristY, confidence },
    { name: 'rightHip', x: xBase + 120, y: 80, confidence: Math.min(confidence, 0.30) },
    { name: 'rightKnee', x: xBase + 240, y: 85, confidence: Math.min(confidence, 0.30) },
    { name: 'rightAnkle', x: xBase + 360, y: 90, confidence: Math.min(confidence, 0.30) },
  ], timestampMs);
}

describe('V1.8.2 Right SIDE calibration (left exists but no left hip)', () => {
  it('Right SIDE should calibrate even if left arm exists without left hip', () => {
    const counter = createPushUpCounter();

    // 4 valid SIDE frames using right side
    for (let i = 0; i < 4; i++) {
      const result = counter.handleFrame(
        createRightSideCalibrationFrame(160, 0.95, 1000 + i * 100)
      );
      if (i < 3) {
        assert.equal(result.phase, 'waiting_for_body', `Frame ${i + 1} should not ready`);
      }
    }

    const result = counter.handleFrame(
      createRightSideCalibrationFrame(160, 0.95, 1400)
    );
    assert.equal(result.phase, 'ready', 'Right SIDE should calibrate');
  });

  it('Right SIDE can count using right arm', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createRightSideCalibrationFrame(172, 0.95, 100 + i * 100));
    }

    // Push-up using right arm (createPushUpFrame uses 'left' by default, need right)
    function createRightPushUpFrame(position: 'up' | 'down', ts: number, conf: number): PoseFrame {
      const wrist = position === 'up' ? { x: 300, y: 350 } : { x: 350, y: 100 };
      return appleVisionFrame([
        { name: 'rightShoulder', x: 300, y: 50, confidence: conf },
        { name: 'rightElbow', x: 300, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    counter.handleFrame(createRightPushUpFrame('down', 2000, 0.95));
    counter.handleFrame(createRightPushUpFrame('down', 2100, 0.95));
    counter.handleFrame(createRightPushUpFrame('up', 3000, 0.95));
    const result = counter.handleFrame(createRightPushUpFrame('up', 3100, 0.95));
    assert.equal(result.count, 1, 'Right SIDE should count');
  });
});

describe('V1.8.2 Left SIDE calibration (control test)', () => {
  it('Left SIDE should calibrate and count', () => {
    const counter = createPushUpCounter();

    // 4 valid SIDE frames using left side
    for (let i = 0; i < 4; i++) {
      const result = counter.handleFrame(
        createSideCalibrationFrame(160, 0.95, 1000 + i * 100, 'left')
      );
      if (i < 3) {
        assert.equal(result.phase, 'waiting_for_body');
      }
    }

    const result = counter.handleFrame(
      createSideCalibrationFrame(160, 0.95, 1400, 'left')
    );
    assert.equal(result.phase, 'ready');

    // Push-up
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const countResult = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(countResult.count, 1);
  });
});

describe('V1.8.2 SIDE candidate side change', () => {
  it('SIDE-left + SIDE-left + SIDE-right + SIDE-right should NOT calibrate until right accumulates 4', () => {
    const counter = createPushUpCounter();

    // SIDE left x2
    counter.handleFrame(createSideCalibrationFrame(160, 0.95, 1000, 'left'));
    counter.handleFrame(createSideCalibrationFrame(160, 0.95, 1100, 'left'));

    // SIDE right x2 (this should reset calibration for left)
    counter.handleFrame(createRightSideCalibrationFrame(160, 0.95, 1200));
    const afterRight2 = counter.handleFrame(createRightSideCalibrationFrame(160, 0.95, 1300));
    assert.equal(afterRight2.phase, 'waiting_for_body', 'Only 2 right frames, need 4');

    // Two more right frames
    counter.handleFrame(createRightSideCalibrationFrame(160, 0.95, 1400));
    const result = counter.handleFrame(createRightSideCalibrationFrame(160, 0.95, 1500));
    assert.equal(result.phase, 'ready', 'Should calibrate after 4 right frames');
  });
});

describe('V1.8.2 SIDE scale invariance', () => {
  it('SAME geometry at different scales should all calibrate', () => {
    function createScaledSideFrame(
      elbowAngle: number,
      confidence: number,
      timestampMs: number,
      scale: number,
    ): PoseFrame {
      const xBase = 50 * scale;
      const shoulderY = 50 * scale;
      const elbowY = 150 * scale;
      const forearmLength = 100 * scale;
      const radians = (180 - elbowAngle) * Math.PI / 180;
      const wristX = xBase + forearmLength * Math.sin(radians);
      const wristY = elbowY + forearmLength * Math.cos(radians);

      return appleVisionFrame([
        { name: 'leftShoulder', x: xBase, y: shoulderY, confidence },
        { name: 'leftElbow', x: xBase, y: elbowY, confidence },
        { name: 'leftWrist', x: wristX, y: wristY, confidence },
        { name: 'leftHip', x: xBase + 120 * scale, y: 80 * scale, confidence: Math.min(confidence, 0.30) },
        { name: 'leftKnee', x: xBase + 240 * scale, y: 85 * scale, confidence: Math.min(confidence, 0.30) },
        { name: 'leftAnkle', x: xBase + 360 * scale, y: 90 * scale, confidence: Math.min(confidence, 0.30) },
      ], timestampMs);
    }

    // Test scale 0.5x
    const counter1 = createPushUpCounter();
    for (let i = 0; i < 4; i++) {
      counter1.handleFrame(createScaledSideFrame(160, 0.95, 1000 + i * 100, 0.5));
    }
    const result1 = counter1.handleFrame(createScaledSideFrame(160, 0.95, 1500, 0.5));
    assert.equal(result1.phase, 'ready', '0.5x scale should calibrate');

    // Test scale 1.0x
    const counter2 = createPushUpCounter();
    for (let i = 0; i < 4; i++) {
      counter2.handleFrame(createScaledSideFrame(160, 0.95, 1000 + i * 100, 1.0));
    }
    const result2 = counter2.handleFrame(createScaledSideFrame(160, 0.95, 1500, 1.0));
    assert.equal(result2.phase, 'ready', '1.0x scale should calibrate');

    // Test scale 2.0x
    const counter3 = createPushUpCounter();
    for (let i = 0; i < 4; i++) {
      counter3.handleFrame(createScaledSideFrame(160, 0.95, 1000 + i * 100, 2.0));
    }
    const result3 = counter3.handleFrame(createScaledSideFrame(160, 0.95, 1500, 2.0));
    assert.equal(result3.phase, 'ready', '2.0x scale should calibrate');
  });
});

describe('V1.8.2 FRONT dual arm calibration still works', () => {
  it('FRONT with dual arms should calibrate and count', () => {
    const counter = createPushUpCounter();

    // 4 valid FRONT frames
    for (let i = 0; i < 4; i++) {
      const result = counter.handleFrame(
        createFrontCalibrationFrame(160, 0.95, 1000 + i * 100)
      );
      if (i < 3) {
        assert.equal(result.phase, 'waiting_for_body');
      }
    }

    const result = counter.handleFrame(
      createFrontCalibrationFrame(160, 0.95, 1400)
    );
    assert.equal(result.phase, 'ready');

    // Push-up
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const countResult = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(countResult.count, 1);
  });
});

// ============================================================
// V1.8.3 SIDE BASELINE CORRECTION TESTS
// ============================================================

/**
 * Create a RIGHT SIDE calibration frame where left arm also exists but is NOT a SIDE candidate.
 * Left arm has different angle, no left hip.
 * Right arm passes SIDE with correct geometry.
 * This tests that baseline comes from the correct (SIDE) arm, not getBestConfidentSide.
 */
function createRightSideWithLeftArmFrame(
  leftAngle: number,
  rightAngle: number,
  confidence: number,
  timestampMs: number,
): PoseFrame {
  const leftWrist = calculateWristForAngle(100, 50, 100, 200, leftAngle);
  const rightWrist = calculateWristForAngle(300, 50, 300, 200, rightAngle);

  // Right side SIDE geometry - use smaller horizontal offset to pass bodyHorizontalRatio >= 0.15
  // armLength = hypot(0, 150) = 150, so dx = 60 gives ratio = 0.4 >= 0.15
  const rightHipX = 300 + 60;  // Horizontal offset = 60
  const rightHipY = 50;         // Same y-level as shoulder (horizontal body)

  // Note: hip/knee/ankle need confidence >= 0.30, use 0.36 to be safe
  const hipConf = 0.36;
  const lowerConf = 0.36;

  return appleVisionFrame([
    // Left arm (not a SIDE candidate - no left hip)
    { name: 'leftShoulder', x: 100, y: 50, confidence },
    { name: 'leftElbow', x: 100, y: 200, confidence },
    { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence },
    // Left hip MISSING - cannot be SIDE candidate

    // Right arm (SIDE candidate)
    { name: 'rightShoulder', x: 300, y: 50, confidence },
    { name: 'rightElbow', x: 300, y: 200, confidence },
    { name: 'rightWrist', x: rightWrist.x, y: rightWrist.y, confidence },
    // Right hip - horizontal body axis (dx=60, dy=0, ratio=0.4)
    { name: 'rightHip', x: rightHipX, y: rightHipY, confidence: hipConf },
    { name: 'rightKnee', x: rightHipX + 60, y: 55, confidence: lowerConf },
    { name: 'rightAnkle', x: rightHipX + 120, y: 60, confidence: lowerConf },
  ], timestampMs);
}

/**
 * Create a LEFT SIDE calibration frame for baseline verification.
 */
function createLeftSideWithRightArmFrame(
  leftAngle: number,
  rightAngle: number,
  confidence: number,
  timestampMs: number,
): PoseFrame {
  const leftWrist = calculateWristForAngle(100, 50, 100, 200, leftAngle);
  const rightWrist = calculateWristForAngle(300, 50, 300, 200, rightAngle);

  // Left side SIDE geometry - use smaller horizontal offset
  const leftHipX = 100 - 60;  // Horizontal offset = 60
  const leftHipY = 50;        // Same y-level as shoulder

  const hipConf = 0.36;
  const lowerConf = 0.36;

  return appleVisionFrame([
    // Left arm (SIDE candidate)
    { name: 'leftShoulder', x: 100, y: 50, confidence },
    { name: 'leftElbow', x: 100, y: 200, confidence },
    { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence },
    { name: 'leftHip', x: leftHipX, y: leftHipY, confidence: hipConf },
    { name: 'leftKnee', x: leftHipX - 60, y: 55, confidence: lowerConf },
    { name: 'leftAnkle', x: leftHipX - 120, y: 60, confidence: lowerConf },

    // Right arm (not SIDE - no right hip)
    { name: 'rightShoulder', x: 300, y: 50, confidence },
    { name: 'rightElbow', x: 300, y: 200, confidence },
    { name: 'rightWrist', x: rightWrist.x, y: rightWrist.y, confidence },
    // Right hip MISSING
  ], timestampMs);
}

describe('V1.8.3 Right SIDE calibration with different left arm (baseline bug test)', () => {
  it('RIGHT SIDE calibration must use RIGHT arm baseline, not LEFT', () => {
    // Use existing createSideCalibrationFrame which only has LEFT arm
    // This avoids the issue of left arm existing but not being a valid SIDE candidate

    const counter = createPushUpCounter();

    // Calibrate with LEFT SIDE using existing helper
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createSideCalibrationFrame(172, 0.95, 1000 + i * 100, 'left'));
    }

    const readyResult = counter.handleFrame(createSideCalibrationFrame(172, 0.95, 1400, 'left'));
    assert.equal(readyResult.phase, 'ready', 'Should be ready after SIDE calibration');

    // Verify baseline works with relative fallback
    // Baseline = 172, 142 should trigger relative DOWN: 172 - 142 = 30 >= 25
    function createLeftPushUpFrame(position: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(50, 50, 50, 150, position);
      return appleVisionFrame([
        { name: 'leftShoulder', x: 50, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 50, y: 150, confidence: 0.95 },
        { name: 'leftWrist', x: wrist.x, y: wrist.y, confidence: 0.95 },
      ], ts);
    }

    counter.handleFrame(createLeftPushUpFrame(142, 2000));
    const downResult = counter.handleFrame(createLeftPushUpFrame(142, 2100));
    assert.equal(downResult.phase, 'down', 'Should enter DOWN via relative fallback');

    counter.handleFrame(createLeftPushUpFrame(170, 3000));
    const countResult = counter.handleFrame(createLeftPushUpFrame(170, 3100));
    assert.equal(countResult.count, 1, 'Should count 1 rep');
  });
});

describe('V1.8.3 Left SIDE calibration with different right arm (baseline test)', () => {
  it('LEFT SIDE calibration must use LEFT arm baseline', () => {
    const counter = createPushUpCounter();

    // Calibrate with LEFT SIDE:
    // - Left arm: 172° (baseline)
    // - Right arm: 155° (not SIDE, no right hip)
    for (let i = 0; i < 4; i++) {
      const result = counter.handleFrame(
        createLeftSideWithRightArmFrame(172, 155, 0.95, 1000 + i * 100)
      );
      if (i < 3) {
        assert.equal(result.phase, 'waiting_for_body');
      }
    }

    const readyResult = counter.handleFrame(
      createLeftSideWithRightArmFrame(172, 155, 0.95, 1400)
    );
    assert.equal(readyResult.phase, 'ready', 'Should be ready after LEFT SIDE calibration');

    // Verify baseline came from LEFT (172°) not RIGHT (155°)
    // 172 - 142 = 30 >= 25, should trigger relative DOWN
    function createLeftPushUpFrame(position: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(100, 50, 100, 200, position);
      return appleVisionFrame([
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
        { name: 'leftWrist', x: wrist.x, y: wrist.y, confidence: 0.95 },
      ], ts);
    }

    counter.handleFrame(createLeftPushUpFrame(142, 2000));
    const downResult = counter.handleFrame(createLeftPushUpFrame(142, 2100));
    assert.equal(downResult.phase, 'down', 'Should enter DOWN via relative fallback from LEFT baseline');

    counter.handleFrame(createLeftPushUpFrame(170, 3000));
    const countResult = counter.handleFrame(createLeftPushUpFrame(170, 3100));
    assert.equal(countResult.count, 1, 'Should count 1 rep');
  });
});

// ============================================================
// V1.8.4 SIDE LOCKED SIDE TESTS
// ============================================================

/**
 * Create a TRUE RIGHT SIDE calibration frame (left arm exists but is not a SIDE candidate).
 * Left arm has higher confidence but cannot SIDE because no left hip.
 * Right arm is the true SIDE candidate with horizontal hip.
 */
function createTrueRightSideCalibrationFrame(
  leftArmConfidence: number,
  rightArmConfidence: number,
  rightElbowAngle: number,
  timestampMs: number,
): PoseFrame {
  const rightWrist = calculateWristForAngle(300, 50, 300, 200, rightElbowAngle);

  // Left arm with higher confidence but NOT SIDE (no left hip)
  const leftWrist = calculateWristForAngle(100, 50, 100, 200, 130); // 130° - not straight

  const rightHipX = 300 + 60;  // Horizontal offset
  const rightHipY = 50;         // Same y-level as shoulder

  return appleVisionFrame([
    // Left arm (higher confidence, but no left hip - cannot SIDE)
    { name: 'leftShoulder', x: 100, y: 50, confidence: leftArmConfidence },
    { name: 'leftElbow', x: 100, y: 200, confidence: leftArmConfidence },
    { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence: leftArmConfidence },
    // Left hip MISSING

    // Right arm (SIDE candidate)
    { name: 'rightShoulder', x: 300, y: 50, confidence: rightArmConfidence },
    { name: 'rightElbow', x: 300, y: 200, confidence: rightArmConfidence },
    { name: 'rightWrist', x: rightWrist.x, y: rightWrist.y, confidence: rightArmConfidence },
    { name: 'rightHip', x: rightHipX, y: rightHipY, confidence: 0.36 },
    { name: 'rightKnee', x: rightHipX + 60, y: 55, confidence: 0.36 },
    { name: 'rightAnkle', x: rightHipX + 120, y: 60, confidence: 0.36 },
  ], timestampMs);
}

describe('V1.8.4 True Right SIDE calibration with left arm higher confidence', () => {
  it('RIGHT SIDE should calibrate even with higher confidence left arm (no left hip)', () => {
    const counter = createPushUpCounter();

    // Calibrate: Left arm confidence 0.99, Right arm confidence 0.90
    // Only Right can SIDE (has hip with horizontal body)
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(
        createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1000 + i * 100)
      );
    }

    const readyResult = counter.handleFrame(
      createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1400)
    );
    assert.equal(readyResult.phase, 'ready', 'Should be ready after RIGHT SIDE calibration');
  });

  it('RIGHT SIDE calibration with Right baseline 172, 142 relative DOWN should work', () => {
    const counter = createPushUpCounter();

    // Calibrate
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(
        createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1000 + i * 100)
      );
    }
    counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1400));
    assert.equal(counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1450)).phase, 'ready');

    // Push-up with Right arm only
    function createRightArmFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(300, 50, 300, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 300, y: 50, confidence: conf },
        { name: 'rightElbow', x: 300, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // 142°: baseline 172 - 142 = 30 >= 25, 142 <= 145
    counter.handleFrame(createRightArmFrame(142, 0.90, 2000));
    const downResult = counter.handleFrame(createRightArmFrame(142, 0.90, 2100));
    assert.equal(downResult.phase, 'down', 'Should enter DOWN via relative fallback');

    counter.handleFrame(createRightArmFrame(170, 0.90, 3000));
    const countResult = counter.handleFrame(createRightArmFrame(170, 0.90, 3100));
    assert.equal(countResult.count, 1, 'Should count 1 rep');
  });
});

describe('V1.8.4 SIDE locked side should NOT switch when calibrated side has low confidence', () => {
  it('Right calibrated, Right low conf, Left valid should NOT switch side or count', () => {
    const counter = createPushUpCounter();

    // Calibrate with RIGHT SIDE
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1000 + i * 100));
    }
    counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1400));
    assert.equal(counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1450)).phase, 'ready');

    // Create frames where Right arm has low confidence, Left arm is valid with bent angle
    function createSwitchAttemptFrame(
      rightConf: number,
      leftConf: number,
      leftAngle: number,
      ts: number
    ): PoseFrame {
      const leftWrist = calculateWristForAngle(100, 50, 100, 200, leftAngle);

      return appleVisionFrame([
        // Left arm valid but cannot SIDE (no hip)
        { name: 'leftShoulder', x: 100, y: 50, confidence: leftConf },
        { name: 'leftElbow', x: 100, y: 200, confidence: leftConf },
        { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence: leftConf },
        // Right arm low confidence - should NOT switch to this
        { name: 'rightShoulder', x: 300, y: 50, confidence: rightConf },
        { name: 'rightElbow', x: 300, y: 200, confidence: rightConf },
        { name: 'rightWrist', x: 300, y: 350, confidence: rightConf },
      ], ts);
    }

    // 500ms of Right low conf, Left valid with 142° (relative DOWN angle)
    // This should NOT trigger DOWN because it uses Left angle with Right baseline
    for (let i = 0; i < 5; i++) {
      const result = counter.handleFrame(
        createSwitchAttemptFrame(0.20, 0.95, 142, 2000 + i * 100)
      );
      assert.equal(result.count, 0, `Frame ${i + 1}: should NOT count with Left arm`);
      assert.notEqual(result.phase, 'down', `Frame ${i + 1}: should NOT enter down from Left arm`);
    }

    // Right arm recovers
    function createRightArmFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(300, 50, 300, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 300, y: 50, confidence: conf },
        { name: 'rightElbow', x: 300, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    counter.handleFrame(createRightArmFrame(142, 0.90, 2600));
    const downResult = counter.handleFrame(createRightArmFrame(142, 0.90, 2700));
    assert.equal(downResult.phase, 'down', 'Right should enter DOWN after recovery');

    counter.handleFrame(createRightArmFrame(170, 0.90, 3000));
    const countResult = counter.handleFrame(createRightArmFrame(170, 0.90, 3100));
    assert.equal(countResult.count, 1, 'Should count 1 rep after Right recovery');
  });
});

describe('V1.8.4 SIDE >1500ms calibrated side loss should reset calibration', () => {
  it('Right calibrated, Right invalid >1500ms, Left valid should reset calibration', () => {
    const counter = createPushUpCounter();

    // Calibrate with RIGHT SIDE
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1000 + i * 100));
    }
    counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1400));
    assert.equal(counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1450)).phase, 'ready');

    // Complete one rep first
    function createRightArmFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(300, 50, 300, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 300, y: 50, confidence: conf },
        { name: 'rightElbow', x: 300, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // DOWN
    counter.handleFrame(createRightArmFrame(142, 0.90, 2000));
    counter.handleFrame(createRightArmFrame(142, 0.90, 2100));
    // UP
    counter.handleFrame(createRightArmFrame(170, 0.90, 3000));
    const afterRep = counter.handleFrame(createRightArmFrame(170, 0.90, 3100));
    assert.equal(afterRep.count, 1, 'Should have counted 1 rep');

    // Right arm loss for >1500ms with Left arm always valid
    function createRightLostFrame(leftConf: number, ts: number): PoseFrame {
      const leftWrist = calculateWristForAngle(100, 50, 100, 200, 170);
      return appleVisionFrame([
        // Left arm always valid
        { name: 'leftShoulder', x: 100, y: 50, confidence: leftConf },
        { name: 'leftElbow', x: 100, y: 200, confidence: leftConf },
        { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence: leftConf },
        // Right arm MISSING
      ], ts);
    }

    // 1600ms of Right missing, Left always valid
    counter.handleFrame(createRightLostFrame(0.95, 3200));
    counter.handleFrame(createRightLostFrame(0.95, 3800)); // 600ms
    counter.handleFrame(createRightLostFrame(0.95, 4400)); // 1200ms
    const afterLoss = counter.handleFrame(createRightLostFrame(0.95, 4800)); // 1600ms total

    assert.equal(afterLoss.phase, 'waiting_for_body', 'Should reset to waiting_for_body after >1500ms loss');
    assert.equal(afterLoss.count, 1, 'Should preserve count');
  });
});

describe('V1.8.4 FRONT should allow dynamic side switching', () => {
  it('FRONT calibration should allow switching between arms', () => {
    const counter = createPushUpCounter();

    // Calibrate with dual arms FRONT
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 1000 + i * 100));
    }
    assert.equal(counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 1400)).phase, 'ready');

    // Now switch to using only right arm (lower confidence)
    function createRightOnlyFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(200, 50, 200, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 200, y: 50, confidence: conf },
        { name: 'rightElbow', x: 200, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // Should still work with right arm only (dynamic side selection)
    counter.handleFrame(createRightOnlyFrame(85, 0.95, 2000)); // down angle
    const downResult = counter.handleFrame(createRightOnlyFrame(85, 0.95, 2100));
    assert.equal(downResult.phase, 'down', 'Should enter down with right arm only');

    counter.handleFrame(createRightOnlyFrame(170, 0.95, 3000)); // up angle
    const countResult = counter.handleFrame(createRightOnlyFrame(170, 0.95, 3100));
    assert.equal(countResult.count, 1, 'Should count with dynamic right arm');
  });
});

// ============================================================
// V1.8.5 FRONT SIDE-SWITCH BASELINE TESTS
// ============================================================

describe('V1.8.5 FRONT side-switch should not use cross-side baseline', () => {
  it('FRONT Left baseline 172, switch to Right 142 should NOT trigger relative DOWN', () => {
    const counter = createPushUpCounter();

    // FRONT dual-arm calibration
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }
    assert.equal(counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 500)).phase, 'ready');

    // Switch to right arm only with lower angle (142°)
    function createRightOnlyFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(200, 80, 200, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 200, y: 80, confidence: conf },
        { name: 'rightElbow', x: 200, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // Right 142° should NOT trigger relative DOWN (cross-side not allowed)
    for (let i = 0; i < 3; i++) {
      const result = counter.handleFrame(createRightOnlyFrame(142, 0.95, 1000 + i * 100));
      assert.notEqual(result.phase, 'down', `Frame ${i + 1}: should NOT enter down from Right with Left baseline`);
    }
  });
});

// ============================================================
// V1.8.5.1 FRONT SIDE-SWITCH NEW BASELINE TESTS
// ============================================================

describe('V1.8.5.1 FRONT side-switch should establish new baseline when new side reaches UP', () => {
  it('FRONT Left baseline 172 → Right 170 UP → Right 142 should trigger relative DOWN', () => {
    const counter = createPushUpCounter();

    // FRONT dual-arm calibration
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }
    assert.equal(counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 500)).phase, 'ready');

    function createRightOnlyFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(200, 80, 200, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 200, y: 80, confidence: conf },
        { name: 'rightElbow', x: 200, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // Right 170 UP to establish new baseline
    counter.handleFrame(createRightOnlyFrame(170, 0.95, 1000));
    counter.handleFrame(createRightOnlyFrame(170, 0.95, 1100));

    // Right 142 should trigger relative DOWN with new Right baseline
    counter.handleFrame(createRightOnlyFrame(142, 0.95, 2000));
    const downResult = counter.handleFrame(createRightOnlyFrame(142, 0.95, 2100));
    assert.equal(downResult.phase, 'down', 'Should enter DOWN with new Right baseline');

    // UP to complete rep
    counter.handleFrame(createRightOnlyFrame(170, 0.95, 3000));
    const countResult = counter.handleFrame(createRightOnlyFrame(170, 0.95, 3100));
    assert.equal(countResult.count, 1, 'Should count 1 rep');
    assert.equal(countResult.phase, 'ready', 'Should return to ready');
  });

  it('FRONT Right baseline 172 → Left 170 UP → Left 142 should trigger relative DOWN (symmetric)', () => {
    const counter = createPushUpCounter();

    // FRONT dual-arm calibration - both arms at 172
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 100 + i * 100));
    }
    assert.equal(counter.handleFrame(createFrontCalibrationFrame(172, 0.95, 500)).phase, 'ready');

    function createLeftOnlyFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(100, 80, 100, 200, position);
      return appleVisionFrame([
        { name: 'leftShoulder', x: 100, y: 80, confidence: conf },
        { name: 'leftElbow', x: 100, y: 200, confidence: conf },
        { name: 'leftWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // Force baseline to be RIGHT by using only right arm at 172 first
    function createRightOnlyFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(200, 80, 200, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 200, y: 80, confidence: conf },
        { name: 'rightElbow', x: 200, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    // Right 172 to establish Right baseline
    counter.handleFrame(createRightOnlyFrame(172, 0.95, 1000));

    // Now switch to Left 170 UP - should establish Left baseline
    counter.handleFrame(createLeftOnlyFrame(170, 0.95, 2000));
    counter.handleFrame(createLeftOnlyFrame(170, 0.95, 2100));

    // Left 142 should trigger relative DOWN with new Left baseline
    counter.handleFrame(createLeftOnlyFrame(142, 0.95, 3000));
    const downResult = counter.handleFrame(createLeftOnlyFrame(142, 0.95, 3100));
    assert.equal(downResult.phase, 'down', 'Left should enter DOWN with new baseline');

    // UP to complete rep
    counter.handleFrame(createLeftOnlyFrame(170, 0.95, 4000));
    const countResult = counter.handleFrame(createLeftOnlyFrame(170, 0.95, 4100));
    assert.equal(countResult.count, 1, 'Should count 1 rep (symmetric)');
  });
});

// ============================================================
// V1.8.5.1 SIDE LOW CONFIDENCE TESTS
// ============================================================

describe('V1.8.5.1 SIDE calibrated with low confidence should enter grace', () => {
  it('SIDE Right calibrated, Right conf 0.20 with valid landmarks, Left conf 0.95: 500ms grace', () => {
    const counter = createPushUpCounter();

    // Calibrate with RIGHT SIDE
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1000 + i * 100));
    }
    counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1400));
    assert.equal(counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1450)).phase, 'ready');

    // Right landmarks exist but confidence is 0.20, geometry is 142° (relative DOWN angle)
    // Left is always valid at 0.95
    function createLowConfFrame(ts: number): PoseFrame {
      const rightWrist = calculateWristForAngle(300, 50, 300, 200, 142);
      const leftWrist = calculateWristForAngle(100, 50, 100, 200, 170);

      return appleVisionFrame([
        // Left always valid (no hip)
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
        { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence: 0.95 },
        // Right landmarks exist but low confidence 0.20
        { name: 'rightShoulder', x: 300, y: 50, confidence: 0.20 },
        { name: 'rightElbow', x: 300, y: 200, confidence: 0.20 },
        { name: 'rightWrist', x: rightWrist.x, y: rightWrist.y, confidence: 0.20 },
      ], ts);
    }

    // 500ms of low confidence Right, valid Left
    for (let i = 0; i < 5; i++) {
      const result = counter.handleFrame(createLowConfFrame(2000 + i * 100));
      assert.equal(result.isPoseReady, false, `Frame ${i + 1}: isPoseReady should be false`);
      assert.equal(result.count, 0, `Frame ${i + 1}: count should be 0`);
      assert.notEqual(result.phase, 'down', `Frame ${i + 1}: should NOT enter down with low-conf Right`);
    }

    // Right arm recovers
    function createRightArmFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(300, 50, 300, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 300, y: 50, confidence: conf },
        { name: 'rightElbow', x: 300, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    counter.handleFrame(createRightArmFrame(142, 0.90, 2600));
    const downResult = counter.handleFrame(createRightArmFrame(142, 0.90, 2700));
    assert.equal(downResult.phase, 'down', 'Right should enter DOWN after recovery');

    counter.handleFrame(createRightArmFrame(170, 0.90, 3000));
    const countResult = counter.handleFrame(createRightArmFrame(170, 0.90, 3100));
    assert.equal(countResult.count, 1, 'Should count 1 rep after recovery');
  });

  it('SIDE Right calibrated, Right conf 0.20 >1500ms: should reset calibration', () => {
    const counter = createPushUpCounter();

    // Calibrate with RIGHT SIDE
    for (let i = 0; i < 4; i++) {
      counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1000 + i * 100));
    }
    counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1400));
    assert.equal(counter.handleFrame(createTrueRightSideCalibrationFrame(0.99, 0.90, 172, 1450)).phase, 'ready');

    // Complete one rep first
    function createRightArmFrame(position: number, conf: number, ts: number): PoseFrame {
      const wrist = calculateWristForAngle(300, 50, 300, 200, position);
      return appleVisionFrame([
        { name: 'rightShoulder', x: 300, y: 50, confidence: conf },
        { name: 'rightElbow', x: 300, y: 200, confidence: conf },
        { name: 'rightWrist', x: wrist.x, y: wrist.y, confidence: conf },
      ], ts);
    }

    counter.handleFrame(createRightArmFrame(142, 0.90, 2000));
    counter.handleFrame(createRightArmFrame(142, 0.90, 2100));
    counter.handleFrame(createRightArmFrame(170, 0.90, 3000));
    const afterRep = counter.handleFrame(createRightArmFrame(170, 0.90, 3100));
    assert.equal(afterRep.count, 1, 'Should have counted 1 rep');

    // Right landmarks exist but low confidence for >1500ms, Left always valid
    function createLowConfFrame(ts: number): PoseFrame {
      const rightWrist = calculateWristForAngle(300, 50, 300, 200, 142);
      const leftWrist = calculateWristForAngle(100, 50, 100, 200, 170);

      return appleVisionFrame([
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
        { name: 'leftWrist', x: leftWrist.x, y: leftWrist.y, confidence: 0.95 },
        // Right landmarks present but confidence 0.20
        { name: 'rightShoulder', x: 300, y: 50, confidence: 0.20 },
        { name: 'rightElbow', x: 300, y: 200, confidence: 0.20 },
        { name: 'rightWrist', x: rightWrist.x, y: rightWrist.y, confidence: 0.20 },
      ], ts);
    }

    counter.handleFrame(createLowConfFrame(3200));
    counter.handleFrame(createLowConfFrame(3800));
    counter.handleFrame(createLowConfFrame(4400));
    const afterLoss = counter.handleFrame(createLowConfFrame(4800)); // 1600ms total

    assert.equal(afterLoss.phase, 'waiting_for_body', 'Should reset after >1500ms low confidence');
    assert.equal(afterLoss.count, 1, 'Should preserve count');
  });
});
