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

      // Standing frames should trigger standing rejection
      for (let i = 0; i < 5; i++) {
        counter.handleFrame(createStandingFrame(0.95, 1000 + i * 100));
      }

      // Try to push up while standing
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2000, false));
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2100, false));
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2200, false));
      counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2300, false));
      counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2400, false));
      const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2500, false));

      // Should not count while standing
      assert.equal(result.count, 0, 'Standing with arm bend should NOT count');
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
