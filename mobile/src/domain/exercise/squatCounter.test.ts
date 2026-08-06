import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSquatCounter, type PoseFrame, type PoseLandmarkName } from './pushupCounter.ts';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

/**
 * Test fixtures for squat counter with proper geometry.
 *
 * Coordinates are in upright-top-left-unmirrored space (pixels).
 *
 * Standing pose:
 * - Shoulders at y=100, centered at x=150
 * - Hips at y=240
 * - Knees aligned with hips at x=150, y=400 (straight line)
 * - Ankles at y=560
 * - Torso size = 140px
 * - Knee angle ~180° (straight line)
 *
 * Squatting pose:
 * - Shoulders at y=160 (drop with hip)
 * - Hips at y=300
 * - Knees at x=0/300, y=400 (knees very forward)
 * - Ankles at y=560
 * - Torso size = 140px (same as standing!)
 * - Knee angle ~80° (clear squat)
 * - Hip angle ~119° (below threshold)
 * - hipDropRatio = 60/140 ≈ 0.43 > 0.05 (valid)
 * - scaleChangeRatio = 0 (torso same size)
 */
function fullBodyFrame(
  pose: 'standing' | 'squatting',
  timestampMs: number,
  confidence = 0.95,
): PoseFrame {
  const lowerBody = pose === 'standing'
    ? {
        // Standing: straight line hip(150,240) → knee(150,400) → ankle(150,560)
        leftHip: { x: 150, y: 240 },
        rightHip: { x: 150, y: 240 },
        leftKnee: { x: 150, y: 400 },
        rightKnee: { x: 150, y: 400 },
        leftAnkle: { x: 150, y: 560 },
        rightAnkle: { x: 150, y: 560 },
      }
    : {
        // Squat: shoulder drops with hip, knees very forward
        // Torso stays same size, only hip angle changes
        leftHip: { x: 150, y: 300 },
        rightHip: { x: 150, y: 300 },
        leftKnee: { x: 0, y: 400 },
        rightKnee: { x: 300, y: 400 },
        leftAnkle: { x: 150, y: 560 },
        rightAnkle: { x: 150, y: 560 },
      };

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Standing: shoulders at y=100, Squat: shoulders at y=160 (drop with hip)
      landmark('leftShoulder', 140, pose === 'standing' ? 100 : 160, confidence),
      landmark('rightShoulder', 160, pose === 'standing' ? 100 : 160, confidence),
      landmark('leftHip', lowerBody.leftHip.x, lowerBody.leftHip.y, confidence),
      landmark('rightHip', lowerBody.rightHip.x, lowerBody.rightHip.y, confidence),
      landmark('leftKnee', lowerBody.leftKnee.x, lowerBody.leftKnee.y, confidence),
      landmark('rightKnee', lowerBody.rightKnee.x, lowerBody.rightKnee.y, confidence),
      landmark('leftAnkle', lowerBody.leftAnkle.x, lowerBody.leftAnkle.y, confidence),
      landmark('rightAnkle', lowerBody.rightAnkle.x, lowerBody.rightAnkle.y, confidence),
    ],
  };
}

describe('squat counter', () => {
  it('starts in waiting_for_body phase', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    const result = counter.handleFrame(fullBodyFrame('standing', 1000));
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.count, 0);
  });

  it('moves to ready after stable standing frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    counter.handleFrame(fullBodyFrame('standing', 1000));
    const result = counter.handleFrame(fullBodyFrame('standing', 1100));
    assert.equal(result.phase, 'ready');
    assert.equal(result.isPoseReady, true);
  });

  it('stays in waiting if not enough stable frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Only 1 standing frame - not enough baseline samples
    counter.handleFrame(fullBodyFrame('standing', 1000));
    // Then squat frame arrives - should stay waiting
    const result = counter.handleFrame(fullBodyFrame('squatting', 1100));
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('does not count when starting already squatting', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Camera sees squat first
    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(fullBodyFrame('squatting', 1100));
    // User returns to standing
    const standingResult = counter.handleFrame(fullBodyFrame('standing', 2000));
    const finalResult = counter.handleFrame(fullBodyFrame('standing', 2100));
    assert.equal(standingResult.count, 0, 'should not count when starting in squat');
    assert.equal(finalResult.count, 0, 'should not count on return to standing');
    assert.equal(finalResult.phase, 'ready');
  });

  it('counts after full standing → squatting → standing cycle', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Establish baseline with stable standing
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    // Move to ready
    let result = counter.handleFrame(fullBodyFrame('standing', 1200));
    assert.equal(result.phase, 'ready');

    // Squat down (need 2+ stable frames)
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    result = counter.handleFrame(fullBodyFrame('squatting', 2200));
    assert.equal(result.phase, 'down');

    // Return to standing
    result = counter.handleFrame(fullBodyFrame('standing', 3000));
    assert.equal(result.count, 0);
    result = counter.handleFrame(fullBodyFrame('standing', 3100));
    assert.equal(result.count, 1, 'should count after full cycle');
    assert.equal(result.phase, 'ready');
  });

  it('does not count if squat then returns to waiting without completing', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Establish baseline
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    // Squat briefly
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    // Go back to standing
    const result = counter.handleFrame(fullBodyFrame('standing', 3000));
    assert.equal(result.count, 0, 'no count without returning to ready first');
  });

  it('counts 5 complete squats', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    for (let i = 0; i < 5; i++) {
      const offset = i * 5000;
      // Establish baseline with stable standing (3 frames)
      counter.handleFrame(fullBodyFrame('standing', 1000 + offset));
      counter.handleFrame(fullBodyFrame('standing', 1100 + offset));
      counter.handleFrame(fullBodyFrame('standing', 1200 + offset));
      // Squat (3 frames for stable)
      counter.handleFrame(fullBodyFrame('squatting', 2000 + offset));
      counter.handleFrame(fullBodyFrame('squatting', 2100 + offset));
      counter.handleFrame(fullBodyFrame('squatting', 2200 + offset));
      // Return to standing (3 frames for stable)
      counter.handleFrame(fullBodyFrame('standing', 3000 + offset));
      counter.handleFrame(fullBodyFrame('standing', 3100 + offset));
      counter.handleFrame(fullBodyFrame('standing', 3200 + offset));
    }

    const result = counter.handleFrame(fullBodyFrame('standing', 26000));
    assert.equal(result.count, 5, 'should count 5 squats');
    assert.equal(result.isComplete, true);
  });

  it('does not count single squat frame', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    const result = counter.handleFrame(fullBodyFrame('squatting', 2000));
    assert.equal(result.count, 0, 'should not count single squat frame');
  });

  it('ignores partial body frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    const partialFrame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        landmark('leftShoulder', 140, 100, 0.95),
        landmark('rightShoulder', 160, 100, 0.95),
        // Missing hips, knees, ankles
      ],
    };
    const result = counter.handleFrame(partialFrame);
    assert.equal(result.isPoseReady, false);
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('reset clears count and phase', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Do one complete squat
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));
    assert.equal(result.count, 1);

    // Reset
    const resetResult = counter.reset();
    assert.equal(resetResult.count, 0);
    assert.equal(resetResult.phase, 'waiting_for_body');
  });

  it('resetTrackingStatePreservingCount preserves count', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Do one complete squat
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));
    assert.equal(result.count, 1);

    // Reset tracking state but preserve count
    const resetResult = counter.resetTrackingStatePreservingCount();
    assert.equal(resetResult.count, 1, 'count should be preserved');
    assert.equal(resetResult.phase, 'waiting_for_body', 'phase should reset');

    // Continue - need to re-establish baseline
    counter.handleFrame(fullBodyFrame('standing', 4000));
    counter.handleFrame(fullBodyFrame('standing', 4100));
    const continueResult = counter.handleFrame(fullBodyFrame('standing', 4200));
    assert.equal(continueResult.phase, 'ready', 'should be ready after baseline');
  });
});
