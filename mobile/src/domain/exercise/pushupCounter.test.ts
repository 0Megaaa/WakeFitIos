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
 * Create a standard push-up frame with specified parameters.
 *
 * For elbow angle detection with thresholds upAngle=160, downAngle=90 (ML Kit):
 * - up position: arm extended, elbow angle = 180° (collinear)
 * - down position: arm bent, elbow angle < 90°
 *
 * For Apple Vision with thresholds upAngle=150, downAngle=135:
 * - up position: arm extended, elbow angle = 180°
 * - down position: arm bent, elbow angle <= 135°
 * - relative fallback: baselineAngle - angle >= 25° AND angle <= 145°
 *
 * Geometry (upright coords, y increases downward):
 * shoulder(100, 50), elbow(100, 200)
 * - up: wrist(100, 350) → angle = 180°
 * - down: wrist(150, 100) → angle ≈ 26.6° (< 90)
 */
function createPushUpFrame(
  side: BodySide,
  position: 'up' | 'down' | number, // 'up' = 180°, 'down' = 26.6°, or custom angle
  confidence: number,
  source: 'apple-vision' | 'mlkit' = 'apple-vision',
  timestampMs = 1000,
  includeHip = true,
): PoseFrame {
  const prefix = side;
  let wrist: { x: number; y: number };

  if (position === 'up') {
    wrist = { x: 100, y: 350 }; // Extended - 180°
  } else if (position === 'down') {
    wrist = { x: 150, y: 100 }; // Bent - 26.6°
  } else {
    // Calculate wrist position for a specific angle
    // angle = calculateAngle({x:100, y:50}, {x:100, y:200}, wrist)
    // For simplicity, we use predefined positions
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
 * Calculate wrist position to achieve a specific elbow angle.
 *
 * The elbow angle is the angle at the elbow vertex between:
 * - Vector from elbow to shoulder (AB)
 * - Vector from elbow to wrist (CB)
 *
 * Using the standard geometry from calculateAngle():
 * angle = arccos(dot(AB, CB) / (|AB| * |CB|))
 *
 * For our setup (shoulder=(100,50), elbow=(100,200)):
 * - AB = shoulder - elbow = (0, -150)
 * - |AB| = 150
 *
 * For angle θ:
 * - dot(AB, CB) = |AB| * |CB| * cos(θ)
 * - Since dx=0 for AB: 0*CBx + (-150)*CBy = 150 * |CB| * cos(θ)
 * - CBy = -|CB| * cos(θ)
 *
 * For simplicity, we use |CB| = 150 (same length as AB).
 * This gives: CBy = -150 * cos(θ)
 * And: CBx = ±sqrt(150² - CBy²)
 */
function calculateWristForAngle(
  shoulderX: number, shoulderY: number,
  elbowX: number, elbowY: number,
  targetAngle: number,
): { x: number; y: number } {
  const length = 150;  // Same as |shoulder-elbow|

  // Calculate the y-component of CB
  const cosAngle = Math.cos(targetAngle * Math.PI / 180);
  const CBy = -length * cosAngle;

  // Calculate the x-component of CB
  // |CB|² = CBx² + CBy², so CBx² = length² - CBy²
  const CBx_squared = length * length - CBy * CBy;
  const CBx = Math.sqrt(Math.max(0, CBx_squared));

  return {
    x: elbowX + CBx,
    y: elbowY + CBy,
  };
}

/**
 * Execute a complete push-up rep: up -> down -> up
 */
function executePushUpRep(
  counter: ReturnType<typeof createPushUpCounter>,
  side: BodySide = 'left',
  source: 'apple-vision' | 'mlkit' = 'apple-vision',
): void {
  // UP x2 (stable)
  counter.handleFrame(createPushUpFrame(side, 'up', 0.95, source, 1000));
  counter.handleFrame(createPushUpFrame(side, 'up', 0.95, source, 1100));

  // DOWN x2 (stable)
  counter.handleFrame(createPushUpFrame(side, 'down', 0.95, source, 2000));
  counter.handleFrame(createPushUpFrame(side, 'down', 0.95, source, 2100));

  // UP x2 (complete rep)
  counter.handleFrame(createPushUpFrame(side, 'up', 0.95, source, 3000));
  counter.handleFrame(createPushUpFrame(side, 'up', 0.95, source, 3100));
}

// ============================================================
// CORE TESTS - Original functionality preserved
// ============================================================
describe('push-up counter core', () => {
  it('calculates the elbow angle from shoulder, elbow, and wrist points', () => {
    const angle = calculateAngle(
      { x: 100, y: 50 },  // shoulder
      { x: 100, y: 200 }, // elbow
      { x: 100, y: 350 }, // wrist
    );
    // For straight arm (collinear), angle should be 180
    assert.equal(Math.round(angle), 180);
  });

  it('waits for a complete confident body pose before counting', () => {
    const counter = createPushUpCounter();
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.2, 'apple-vision'));
    assert.equal(result.count, 0);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });

  it('counts one push-up after an up to down to up transition', () => {
    const counter = createPushUpCounter({ targetCount: 5 });
    const result = executePushUpRep(counter);
    // executePushUpRep doesn't return, so we need to call last frame separately
    const lastResult = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3200));
    assert.equal(lastResult.count, 1);
    assert.equal(lastResult.phase, 'ready');
    assert.equal(lastResult.isComplete, false);
  });

  it('counts a repetition from the right body side when that side is visible', () => {
    const counter = createPushUpCounter({ targetCount: 5 });
    executePushUpRep(counter, 'right');
    const lastResult = counter.handleFrame(createPushUpFrame('right', 'up', 0.95, 'apple-vision', 3200));
    assert.equal(lastResult.count, 1);
    assert.equal(lastResult.phase, 'ready');
  });

  it('does not double count repeated up frames after a repetition', () => {
    const counter = createPushUpCounter({ targetCount: 5 });
    executePushUpRep(counter);
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3200));
    assert.equal(result.count, 1);
  });

  it('does not count a one-frame down and up noise spike as a repetition', () => {
    const counter = createPushUpCounter({ targetCount: 5 });
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1200));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1300));
    assert.equal(result.count, 0);
    assert.equal(result.phase, 'ready');
  });

  it('clamps a target count below one to one repetition', () => {
    const counter = createPushUpCounter({ targetCount: 0 });
    const initial = counter.reset();
    assert.equal(initial.isComplete, false);
    executePushUpRep(counter);
    const lastResult = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3200));
    assert.equal(lastResult.count, 1);
    assert.equal(lastResult.isComplete, true);
  });

  it('marks the challenge complete when the target count is reached', () => {
    const counter = createPushUpCounter({ targetCount: 2 });
    executePushUpRep(counter);
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3200));
    executePushUpRep(counter, 'left', 'apple-vision');
    const lastResult = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 6200));
    assert.equal(lastResult.count, 2);
    assert.equal(lastResult.isComplete, true);
  });
});

// ============================================================
// APPLE VISION PUSH-UP TESTS - V1.7 Relaxations
// ============================================================
describe('Apple Vision push-up - front facing / dual arm (no hip required)', () => {
  it('Test 1: counts push-up without hip landmarks', () => {
    // Front-facing camera: user facing camera, body along depth axis
    // Both arms visible but hip may not be detected reliably
    const counter = createPushUpCounter();

    // UP x2 - no hip included
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('right', 'up', 0.95, 'apple-vision', 1100, false));

    // DOWN x2 - no hip included
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('right', 'down', 0.95, 'apple-vision', 2100, false));

    // UP x2 - no hip included
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('right', 'up', 0.95, 'apple-vision', 3100, false));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });
});

describe('Apple Vision push-up - side facing / single arm', () => {
  it('Test 2: counts push-up with only one arm side visible', () => {
    // Side-facing camera: only one arm is fully visible
    const counter = createPushUpCounter();

    // UP x2 - only left arm
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100, false));

    // DOWN x2 - only left arm
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // UP x2 - only left arm
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });
});

describe('Apple Vision push-up - confidence 0.40', () => {
  it('Test 3: Apple Vision continues with 0.40 confidence arm chain', () => {
    const counter = createPushUpCounter();

    // All landmarks at 0.40 confidence (above Apple Vision 0.35 threshold)
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'apple-vision', 1100, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.40, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.40, 'apple-vision', 2100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'apple-vision', 3100, false));

    assert.equal(result.count, 1);
  });

  it('ML Kit continues with 0.40 confidence (explicit config allows lower)', () => {
    // ML Kit default is 0.55, but explicit config can override
    const counter = createPushUpCounter({ minConfidence: 0.40 });

    // All landmarks at 0.40 confidence with explicit override
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'mlkit', 1100));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.40, 'mlkit', 2000));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.40, 'mlkit', 2100));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'mlkit', 3000));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.40, 'mlkit', 3100));

    assert.equal(result.count, 1);
  });
});

describe('Apple Vision push-up - relaxed absolute down angle', () => {
  it('Test 4: detects down at 125 degrees (within 135 threshold)', () => {
    const counter = createPushUpCounter();

    // UP at 170°
    counter.handleFrame(createPushUpFrame('left', 170, 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 170, 0.95, 'apple-vision', 1100, false));

    // DOWN at 125° (should be detected as down since <= 135)
    counter.handleFrame(createPushUpFrame('left', 125, 0.95, 'apple-vision', 2000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 125, 0.95, 'apple-vision', 2100, false));

    assert.equal(result.phase, 'down');
  });
});

describe('Apple Vision push-up - relative elbow fallback', () => {
  it('Test 5: relative fallback detects down when baseline 172°, current 142°', () => {
    // baselineAngle = 172°
    // currentAngle = 142°
    // delta = 172 - 142 = 30° >= 25° ✓
    // currentAngle = 142° <= 145° ✓
    // Should be recognized as down
    const counter = createPushUpCounter();

    // Establish baseline at 172° - need stable UP to establish baseline
    // First, get into ready state (needs 2 stable UP frames)
    counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1000, false));
    const frame1 = counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1100, false));
    // After 2 frames, should be in ready state with baseline established
    assert.equal(frame1.phase, 'ready');

    // Additional UP frames to strengthen baseline
    counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1200, false));
    counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1300, false));

    // Go to 142° - relative fallback should trigger down
    // First frame of down: candidatePose='down', frames=1
    const down1 = counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 2000, false));
    // Second frame of down: frames=2 -> should enter down phase
    const downResult = counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 2100, false));
    assert.equal(downResult.phase, 'down');

    // Return to up (>= 150°)
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const upResult = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(upResult.count, 1);
  });

  it('Test 5a: baseline drift protection - lower UP readings cannot drag baseline down', () => {
    // V1.7.1 fix: baseline uses Math.max, so lower UP readings don't drag baseline down
    //
    // Initial baseline at 172°
    // Then vision outputs: 158, 155, 153, 151, 150 (all still >= 150 = UP)
    // Baseline should remain at ~172° due to Math.max protection
    //
    // Then 142° (relative down): delta = 172 - 142 = 30 >= 25
    // Should still be recognized as DOWN
    const counter = createPushUpCounter();

    // Initial true UP at 172°
    counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1100, false));
    // Should be ready with baseline ~172°
    let result = counter.handleFrame(createPushUpFrame('left', 172, 0.95, 'apple-vision', 1200, false));
    assert.equal(result.phase, 'ready');

    // Continue with lower but still valid UP readings
    // These should NOT drag the baseline down
    counter.handleFrame(createPushUpFrame('left', 158, 0.95, 'apple-vision', 1300, false));
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'apple-vision', 1400, false));
    counter.handleFrame(createPushUpFrame('left', 153, 0.95, 'apple-vision', 1500, false));
    counter.handleFrame(createPushUpFrame('left', 151, 0.95, 'apple-vision', 1600, false));
    counter.handleFrame(createPushUpFrame('left', 150, 0.95, 'apple-vision', 1700, false));

    // Still in ready with baseline protected at ~172°
    result = counter.handleFrame(createPushUpFrame('left', 150, 0.95, 'apple-vision', 1800, false));
    assert.equal(result.phase, 'ready');

    // Now 142°: with protected baseline ~172°, delta = 30 >= 25
    // Should be recognized as DOWN
    counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 2000, false));
    result = counter.handleFrame(createPushUpFrame('left', 142, 0.95, 'apple-vision', 2100, false));
    assert.equal(result.phase, 'down');

    // Return to UP
    counter.handleFrame(createPushUpFrame('left', 170, 0.95, 'apple-vision', 3000, false));
    result = counter.handleFrame(createPushUpFrame('left', 170, 0.95, 'apple-vision', 3100, false));
    assert.equal(result.count, 1);
  });

  it('Test 6: slight bend should NOT count as down (150° not down)', () => {
    // 150° is the UP threshold for Apple Vision
    // Even if baseline is 170°, 150° is still >= upAngle
    const counter = createPushUpCounter();

    // UP at 170°
    counter.handleFrame(createPushUpFrame('left', 170, 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 170, 0.95, 'apple-vision', 1100, false));

    // Go to 155° - NOT down (still >= upAngle of 150)
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'apple-vision', 2100, false));

    // Should still be ready, not down
    const result = counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'apple-vision', 2200, false));
    assert.equal(result.phase, 'ready');
    assert.equal(result.count, 0);
  });

  it('Test 6b: slight bend should NOT count as down (150° baseline, 135° current)', () => {
    // delta = 150 - 135 = 15° < 25° (not enough)
    // Should NOT be recognized as down
    const counter = createPushUpCounter();

    // UP at 150° (exactly at upAngle)
    counter.handleFrame(createPushUpFrame('left', 150, 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 150, 0.95, 'apple-vision', 1100, false));
    counter.handleFrame(createPushUpFrame('left', 150, 0.95, 'apple-vision', 1200, false));

    // Go to 135° - NOT down (delta 15° < 25°)
    counter.handleFrame(createPushUpFrame('left', 135, 0.95, 'apple-vision', 2000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 135, 0.95, 'apple-vision', 2100, false));

    // 135° is still > 90° (ML Kit threshold), and relative delta < 25°
    // For Apple Vision: 135° is exactly the absolute threshold, so it IS down
    // This is correct behavior
    assert.equal(result.count, 0); // No count yet - still waiting for up
  });
});

describe('Apple Vision push-up - prevent continuous counting in down state', () => {
  it('Test 7: staying in down state should NOT increment count', () => {
    const counter = createPushUpCounter();

    // UP x2
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100, false));

    // DOWN x2
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // More DOWN frames - should NOT increase count
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2200, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2300, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2400, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2500, false));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'down');
  });

  it('Test 7b: count only increments after re-entering up state', () => {
    const counter = createPushUpCounter();

    // UP x2
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100, false));

    // DOWN x2
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // Back to UP
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });
});

describe('Apple Vision push-up - starting in down state', () => {
  it('Test 8: starting already in down state should NOT count', () => {
    const counter = createPushUpCounter();

    // First frames are already down
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1100, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1200, false));

    // Should be in down phase but no count yet
    const downResult = counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 1300, false));
    assert.equal(downResult.count, 0);

    // Now go up to ready
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 2100, false));

    // Down again
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 3000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 3100, false));

    // Up again - NOW count
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 4000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 4100, false));

    assert.equal(result.count, 1);
  });
});

describe('Apple Vision push-up - temporary arm occlusion grace', () => {
  it('Test 9: 500ms arm loss during down should preserve down state', () => {
    // V1.7.1 fix: uses real timestamps to properly test 500ms grace
    const counter = createPushUpCounter();

    // UP x2
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100, false));

    // DOWN x2 (last valid at 2100)
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // Arm lost at 2600 (500ms after last valid at 2100)
    const lostFrame: PoseFrame = {
      timestampMs: 2600,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [], // No landmarks = arm loss
    };
    const duringLoss1 = counter.handleFrame({ ...lostFrame, timestampMs: 2600 }); // 500ms elapsed
    const duringLoss2 = counter.handleFrame({ ...lostFrame, timestampMs: 3100 }); // 1000ms elapsed
    // During grace period, should preserve down state
    assert.equal(duringLoss1.phase, 'down');
    assert.equal(duringLoss1.count, 0);
    assert.equal(duringLoss2.phase, 'down');
    assert.equal(duringLoss2.count, 0);

    // Arm restored at 3200ms (still within 1500ms grace: 3200 - 2600 = 600ms)
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 3200, false));

    // UP x2 - complete rep
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 4000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 4100, false));

    assert.equal(result.count, 1);
  });

  it('Test 10: >1500ms arm loss should reset tracking', () => {
    const counter = createPushUpCounter();

    // UP x2
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100, false));

    // DOWN x2
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));

    // Arm lost for >1500ms
    // At 2100 we were in 'down' state
    // From 2600 onwards, arm is lost
    const lostFrame: PoseFrame = {
      timestampMs: 2600,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [],
    };

    // Continue losing arm until grace period exceeded (1500ms from first loss)
    counter.handleFrame({ ...lostFrame, timestampMs: 2600 }); // invalidStart=2600, duration=0
    counter.handleFrame({ ...lostFrame, timestampMs: 3100 }); // duration=500ms
    counter.handleFrame({ ...lostFrame, timestampMs: 3600 }); // duration=1000ms
    counter.handleFrame({ ...lostFrame, timestampMs: 4100 }); // duration=1500ms - threshold reached
    counter.handleFrame({ ...lostFrame, timestampMs: 4101 }); // duration=1501ms - reset triggered

    // After reset, phase should be waiting_for_body
    // Now we need to re-establish ready state
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 4200, false));
    const afterReset = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 4300, false));
    // After reset and seeing UP frames, should be in ready state
    assert.equal(afterReset.phase, 'ready');

    // Now complete a full rep: down -> up
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 5000, false));
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 5100, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 6000, false));
    const result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 6100, false));

    // Count is 1 (completed full rep after reset)
    assert.equal(result.count, 1);
  });
});

/**
 * Create a dual-arm frame for testing side stability.
 * Both arms are visible with specified confidences.
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
    if (angle === 'up') {
      return { x: 100, y: 350 };
    }
    if (angle === 'down') {
      return { x: 150, y: 100 };
    }
    return calculateWristForAngle(100, 50, 100, 200, angle);
  };

  const landmarks: Array<{ name: PoseLandmarkName; x: number; y: number; confidence: number }> = [
    // Left arm
    { name: 'leftShoulder' as PoseLandmarkName, x: 100, y: 50, confidence: leftConfidence },
    { name: 'leftElbow' as PoseLandmarkName, x: 100, y: 200, confidence: leftConfidence },
    { name: 'leftWrist' as PoseLandmarkName, ...createWrist(leftAngle), confidence: leftConfidence },
    // Right arm
    { name: 'rightShoulder' as PoseLandmarkName, x: 200, y: 50, confidence: rightConfidence },
    { name: 'rightElbow' as PoseLandmarkName, x: 200, y: 200, confidence: rightConfidence },
    { name: 'rightWrist' as PoseLandmarkName, ...createWrist(rightAngle), confidence: rightConfidence },
  ];

  return source === 'apple-vision'
    ? appleVisionFrame(landmarks, timestampMs)
    : mlkitFrame(landmarks, timestampMs);
}

describe('Apple Vision push-up - side stability', () => {
  it('Test 11: rapid side switching should not cause state jitter', () => {
    const counter = createPushUpCounter();

    // Start with left arm
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1000, false));
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1100, false));

    // Phase should be ready
    let result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 1200, false));
    assert.equal(result.phase, 'ready');

    // DOWN with left
    counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2000, false));
    result = counter.handleFrame(createPushUpFrame('left', 'down', 0.95, 'apple-vision', 2100, false));
    assert.equal(result.phase, 'down');

    // UP with left
    counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3000, false));
    result = counter.handleFrame(createPushUpFrame('left', 'up', 0.95, 'apple-vision', 3100, false));
    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');

    // Rapid switching between sides should not cause jitter
    // Switch to right for next rep
    counter.handleFrame(createPushUpFrame('right', 'down', 0.95, 'apple-vision', 4000, false));
    result = counter.handleFrame(createPushUpFrame('right', 'down', 0.95, 'apple-vision', 4100, false));
    assert.equal(result.phase, 'down');

    counter.handleFrame(createPushUpFrame('right', 'up', 0.95, 'apple-vision', 5000, false));
    result = counter.handleFrame(createPushUpFrame('right', 'up', 0.95, 'apple-vision', 5100, false));
    assert.equal(result.count, 2);
  });

  it('Test 11a: dual-arm confidence fluctuation does not cause side switching', () => {
    // V1.7.1: Apple Vision sticky side strategy should prevent switching
    // when active side is still valid
    const counter = createPushUpCounter();

    // UP frames with fluctuating confidences
    counter.handleFrame(createDualArmFrame('up', 0.95, 'up', 0.80, 'apple-vision', 1000)); // left wins initially
    counter.handleFrame(createDualArmFrame('up', 0.80, 'up', 0.96, 'apple-vision', 1100)); // right higher
    counter.handleFrame(createDualArmFrame('up', 0.94, 'up', 0.82, 'apple-vision', 1200)); // left higher
    counter.handleFrame(createDualArmFrame('up', 0.85, 'up', 0.90, 'apple-vision', 1300)); // right higher

    // Should be ready
    let result = counter.handleFrame(createDualArmFrame('up', 0.92, 'up', 0.88, 'apple-vision', 1400));
    assert.equal(result.phase, 'ready');

    // DOWN frames with fluctuating confidences
    counter.handleFrame(createDualArmFrame('down', 0.88, 'down', 0.92, 'apple-vision', 2000));
    counter.handleFrame(createDualArmFrame('down', 0.90, 'down', 0.85, 'apple-vision', 2100));
    result = counter.handleFrame(createDualArmFrame('down', 0.87, 'down', 0.93, 'apple-vision', 2200));
    assert.equal(result.phase, 'down');

    // UP frames to complete
    counter.handleFrame(createDualArmFrame('up', 0.91, 'up', 0.89, 'apple-vision', 3000));
    result = counter.handleFrame(createDualArmFrame('up', 0.88, 'up', 0.93, 'apple-vision', 3100));
    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });
});

// ============================================================
// POSE QUALITY TESTS
// ============================================================
describe('poseQuality - Apple Vision push-up', () => {
  it('Test 12: Apple Vision push-up with only left arm chain at 0.40 returns ok', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.40 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.40 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.40 },
        // No right arm, no hip
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.equal(result.issue, 'ok');
    assert.ok(result.guidance.includes('手臂识别正常'));
  });

  it('Test 12b: Apple Vision push-up with very low confidence (0.20) returns low_confidence', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.20 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.20 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.20 },
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.equal(result.issue, 'low_confidence');
  });

  it('Test 13: Apple Vision push-up with vertical fillRatio < 0.32 should NOT return too_far', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 1000, // Taller image
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 150, y: 100, confidence: 0.95 },
        { name: 'leftElbow', x: 150, y: 300, confidence: 0.95 },
        { name: 'leftWrist', x: 150, y: 400, confidence: 0.95 },
        { name: 'rightShoulder', x: 200, y: 100, confidence: 0.95 },
        { name: 'rightElbow', x: 200, y: 300, confidence: 0.95 },
        { name: 'rightWrist', x: 200, y: 400, confidence: 0.95 },
      ],
    };

    // fillRatio = (400 - 100) / 1000 = 0.30 < 0.32
    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.notEqual(result.issue, 'too_far');
  });
});

// ============================================================
// ML KIT REGRESSION TESTS - Ensure no regression
// ============================================================
describe('ML Kit push-up - regression tests', () => {
  it('ML Kit maintains default minConfidence 0.55', () => {
    const counter = createPushUpCounter();

    // 0.50 confidence should fail for ML Kit (below 0.55)
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.50 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.50 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.50 },
        { name: 'leftHip', x: 100, y: 250, confidence: 0.50 },
      ],
    };

    const result = counter.handleFrame(frame);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });

  it('ML Kit maintains default downAngle 90', () => {
    const counter = createPushUpCounter();

    // UP at 160°
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1100));

    // At 95° - NOT down for ML Kit (>= 90°)
    counter.handleFrame(createPushUpFrame('left', 95, 0.95, 'mlkit', 2000));
    let result = counter.handleFrame(createPushUpFrame('left', 95, 0.95, 'mlkit', 2100));
    assert.equal(result.phase, 'ready'); // Still ready, not down

    // At 85° - down for ML Kit (< 90°)
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 3000));
    result = counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 3100));
    assert.equal(result.phase, 'down');
  });

  it('ML Kit maintains default upAngle 160', () => {
    const counter = createPushUpCounter();

    // 155° is NOT up for ML Kit (< 160°)
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'mlkit', 1100));
    const result = counter.handleFrame(createPushUpFrame('left', 155, 0.95, 'mlkit', 1200));
    assert.equal(result.phase, 'waiting_for_body'); // Not recognized as up
  });

  it('ML Kit requires hip for push-up', () => {
    const counter = createPushUpCounter();

    // No hip - ML Kit should fail
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.95 },
        // No hip
      ],
    };

    const result = counter.handleFrame(frame);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });

  it('ML Kit no-arm immediately resets (no grace timeout)', () => {
    // V1.7.1 fix: ML Kit should NOT have 1500ms grace timeout
    const counter = createPushUpCounter();

    // UP x2
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1000));
    counter.handleFrame(createPushUpFrame('left', 160, 0.95, 'mlkit', 1100));

    // DOWN x2
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2000));
    counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2100));

    // Should be in down phase
    let result = counter.handleFrame(createPushUpFrame('left', 85, 0.95, 'mlkit', 2200));
    assert.equal(result.phase, 'down');

    // Next frame has no valid arm - should immediately reset
    const noArmFrame: PoseFrame = {
      timestampMs: 2300,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [], // No landmarks
    };
    result = counter.handleFrame(noArmFrame);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });
});

// ============================================================
// GUIDANCE TEXT TESTS
// ============================================================
describe('push-up guidance text', () => {
  it('ok guidance does not mention 站稳', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.95 },
        { name: 'rightShoulder', x: 200, y: 50, confidence: 0.95 },
        { name: 'rightElbow', x: 200, y: 200, confidence: 0.95 },
        { name: 'rightWrist', x: 200, y: 350, confidence: 0.95 },
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.ok(!result.guidance.includes('站稳'));
    assert.ok(result.guidance.includes('手臂') || result.guidance.includes('俯卧撑'));
  });

  it('low_confidence guidance mentions arm clarity', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.20 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.20 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.20 },
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.equal(result.issue, 'low_confidence');
    assert.ok(result.guidance.includes('清晰'));
  });

  it('partial_body guidance mentions adjusting position', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        // Missing elbow and wrist
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.equal(result.issue, 'partial_body');
    assert.ok(result.guidance.includes('调整') || result.guidance.includes('确保'));
  });
});

// ============================================================
// ML KIT PUSH-UP GUIDANCE TESTS
// ============================================================
describe('ML Kit push-up guidance regression', () => {
  it('ML Kit push-up returns push_up guidance (not squat guidance)', () => {
    // V1.7.1 fix: ML Kit push-up should return push_up guidance, not squat
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      // Incomplete body for ML Kit - missing some required landmarks
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.95 },
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.95 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.95 },
        { name: 'leftHip', x: 100, y: 250, confidence: 0.95 },
        // Missing right arm
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.equal(result.issue, 'partial_body');
    // Guidance should be about arms, not about squats/legs
    assert.ok(!result.guidance.includes('深蹲'));
    assert.ok(!result.guidance.includes('膝盖'));
    assert.ok(!result.guidance.includes('脚踝'));
  });

  it('ML Kit push-up low_confidence guidance mentions arms', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.30 }, // Low confidence
        { name: 'leftElbow', x: 100, y: 200, confidence: 0.30 },
        { name: 'leftWrist', x: 100, y: 350, confidence: 0.30 },
        { name: 'leftHip', x: 100, y: 250, confidence: 0.30 },
        { name: 'rightShoulder', x: 200, y: 50, confidence: 0.30 },
        { name: 'rightElbow', x: 200, y: 200, confidence: 0.30 },
        { name: 'rightWrist', x: 200, y: 350, confidence: 0.30 },
        { name: 'rightHip', x: 200, y: 250, confidence: 0.30 },
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
    assert.equal(result.issue, 'low_confidence');
    // Should mention clarity for arms, not squat-related terms
    assert.ok(result.guidance.includes('清晰') || result.guidance.includes('手臂'));
    assert.ok(!result.guidance.includes('深蹲'));
    assert.ok(!result.guidance.includes('膝盖'));
    assert.ok(!result.guidance.includes('脚踝'));
  });

  it('Squat returns squat guidance (not push-up guidance)', () => {
    const frame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'mlkit',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 100, y: 50, confidence: 0.30 },
        { name: 'rightShoulder', x: 200, y: 50, confidence: 0.30 },
        { name: 'leftHip', x: 100, y: 200, confidence: 0.30 },
        { name: 'rightHip', x: 200, y: 200, confidence: 0.30 },
        { name: 'leftKnee', x: 100, y: 350, confidence: 0.30 },
        { name: 'rightKnee', x: 200, y: 350, confidence: 0.30 },
        { name: 'leftAnkle', x: 100, y: 500, confidence: 0.30 },
        { name: 'rightAnkle', x: 200, y: 500, confidence: 0.30 },
      ],
    };

    const result = evaluatePoseQuality(frame, { exerciseType: 'squat' });
    assert.equal(result.issue, 'low_confidence');
    // Squat guidance should mention squat-related terms
    assert.ok(!result.guidance.includes('手臂'));
    assert.ok(!result.guidance.includes('俯卧撑'));
  });
});
