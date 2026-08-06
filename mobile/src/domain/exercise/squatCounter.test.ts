import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSquatCounter, type PoseFrame, type PoseLandmarkName } from './pushupCounter.ts';

type BodySide = 'left' | 'right';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

/**
 * Test fixtures for squat counter.
 *
 * Coordinates are in upright-top-left-unmirrored space (pixels).
 *
 * Standing pose (knee >= 160°):
 * - Shoulders at y=100
 * - Hips at y=240
 * - Knees at y=400 (nearly straight line with ankles)
 * - Ankles at y=560
 *
 * Squatting pose (knee <= 130°):
 * - Knees significantly forward of hips
 * - Hips below shoulders
 * - Clear knee bend angle
 */
function fullBodyFrame(
  pose: 'standing' | 'squatting',
  timestampMs: number,
  confidence = 0.95,
): PoseFrame {
  const lowerBody = pose === 'standing'
    ? {
        leftHip: { x: 110, y: 240 },
        rightHip: { x: 190, y: 240 },
        leftKnee: { x: 115, y: 400 },
        rightKnee: { x: 185, y: 400 },
        leftAnkle: { x: 120, y: 560 },
        rightAnkle: { x: 180, y: 560 },
      }
    : {
        // Squatting: knees forward (smaller x) and hips higher (smaller y)
        leftHip: { x: 115, y: 280 },
        rightHip: { x: 185, y: 280 },
        leftKnee: { x: 60, y: 440 },
        rightKnee: { x: 240, y: 440 },
        leftAnkle: { x: 120, y: 560 },
        rightAnkle: { x: 180, y: 560 },
      };

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      landmark('leftShoulder', 90, 100, confidence),
      landmark('rightShoulder', 210, 100, confidence),
      landmark('leftHip', lowerBody.leftHip.x, lowerBody.leftHip.y, confidence),
      landmark('rightHip', lowerBody.rightHip.x, lowerBody.rightHip.y, confidence),
      landmark('leftKnee', lowerBody.leftKnee.x, lowerBody.leftKnee.y, confidence),
      landmark('rightKnee', lowerBody.rightKnee.x, lowerBody.rightKnee.y, confidence),
      landmark('leftAnkle', lowerBody.leftAnkle.x, lowerBody.leftAnkle.y, confidence),
      landmark('rightAnkle', lowerBody.rightAnkle.x, lowerBody.rightAnkle.y, confidence),
    ],
  };
}

function perspectiveStandingFrame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    imageWidth: 720,
    imageHeight: 720,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      landmark('leftShoulder', 250, 180),
      landmark('rightShoulder', 470, 180),
      landmark('leftHip', 300, 430),
      landmark('rightHip', 420, 430),
      landmark('leftKnee', 305, 530),
      landmark('rightKnee', 415, 530),
      landmark('leftAnkle', 310, 630),
      landmark('rightAnkle', 410, 630),
    ],
  };
}

function perspectiveSquatFrame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    imageWidth: 720,
    imageHeight: 720,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      landmark('leftShoulder', 250, 130),
      landmark('rightShoulder', 470, 130),
      landmark('leftHip', 310, 380),
      landmark('rightHip', 410, 380),
      landmark('leftKnee', 220, 500),
      landmark('rightKnee', 500, 500),
      landmark('leftAnkle', 320, 560),
      landmark('rightAnkle', 400, 560),
    ],
  };
}

function lowConfidenceFullBodyFrame(timestampMs: number): PoseFrame {
  return fullBodyFrame('squatting', timestampMs, 0.2);
}

/**
 * Stable rep: full standing → squatting → standing cycle
 */
function stableRep(counter: ReturnType<typeof createSquatCounter>, startTimestampMs = 1000) {
  counter.handleFrame(fullBodyFrame('standing', startTimestampMs));
  counter.handleFrame(fullBodyFrame('standing', startTimestampMs + 100));
  counter.handleFrame(fullBodyFrame('squatting', startTimestampMs + 1000));
  counter.handleFrame(fullBodyFrame('squatting', startTimestampMs + 1100));
  counter.handleFrame(fullBodyFrame('standing', startTimestampMs + 2000));
  return counter.handleFrame(fullBodyFrame('standing', startTimestampMs + 2100));
}

describe('squat counter core', () => {
  it('waits for a complete confident full-body pose before counting', () => {
    const counter = createSquatCounter();

    const result = counter.handleFrame(fullBodyFrame('standing', 1000, 0.2));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });

  it('counts one squat after a standing to squatting to standing transition', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    const result = stableRep(counter);

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
    assert.equal(result.isComplete, false);
  });

  it('counts a front-view squat through full-body pose classification', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('counts a classified squat even when camera perspective makes hip movement look upward', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(perspectiveStandingFrame(1000));
    counter.handleFrame(perspectiveStandingFrame(1100));
    counter.handleFrame(perspectiveSquatFrame(2000));
    counter.handleFrame(perspectiveSquatFrame(2100));
    counter.handleFrame(perspectiveStandingFrame(3000));
    const result = counter.handleFrame(perspectiveStandingFrame(3100));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('starts already squatting and does not count when returning to standing', () => {
    // User opens camera already in squat position
    const counter = createSquatCounter({ targetCount: 5 });

    // Camera sees squat first
    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(fullBodyFrame('squatting', 1100));

    // User returns to standing - should NOT count
    // State machine requires: waiting_for_body → standing → down_confirmed → standing + count
    const result = counter.handleFrame(fullBodyFrame('standing', 2000));
    const result2 = counter.handleFrame(fullBodyFrame('standing', 2100));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'ready');
    assert.equal(result2.count, 0);
    assert.equal(result2.phase, 'ready');
  });

  it('counts squat only after full cycle: stable standing first, then squat, then standing again', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    // User starts squatting
    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(fullBodyFrame('squatting', 1100));

    // User returns to standing - does NOT count yet
    counter.handleFrame(fullBodyFrame('standing', 2000));
    const standingResult = counter.handleFrame(fullBodyFrame('standing', 2100));
    assert.equal(standingResult.count, 0);
    assert.equal(standingResult.phase, 'ready');

    // NOW complete a full squat cycle
    counter.handleFrame(fullBodyFrame('squatting', 3000));
    counter.handleFrame(fullBodyFrame('squatting', 3100));
    const countResult = counter.handleFrame(fullBodyFrame('standing', 4000));
    const finalResult = counter.handleFrame(fullBodyFrame('standing', 4100));

    assert.equal(finalResult.count, 1);
    assert.equal(finalResult.phase, 'ready');
  });

  it('counts a squat from a single confident down frame between standing frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('does not count another squat until the user has returned to a stable standing pose', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    stableRep(counter, 1000);

    // Try to go back down immediately
    counter.handleFrame(fullBodyFrame('squatting', 3000));
    const repeatedBottom = counter.handleFrame(fullBodyFrame('squatting', 3100));

    assert.equal(repeatedBottom.count, 1);
    assert.equal(repeatedBottom.phase, 'down');
  });

  it('unlocks the next squat only after stable standing frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    stableRep(counter, 1000);

    // Go back to standing first
    counter.handleFrame(fullBodyFrame('standing', 3000));
    counter.handleFrame(fullBodyFrame('standing', 3100));
    // Now go down again
    const second = counter.handleFrame(fullBodyFrame('squatting', 4000));
    const secondDown = counter.handleFrame(fullBodyFrame('squatting', 4100));
    // Stand back up to complete
    const countResult = counter.handleFrame(fullBodyFrame('standing', 5000));
    const finalResult = counter.handleFrame(fullBodyFrame('standing', 5100));

    assert.equal(finalResult.count, 2);
    assert.equal(finalResult.phase, 'ready');
  });

  it('keeps the squat phase through a brief low-confidence frame', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(lowConfidenceFullBodyFrame(2200));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('does not count apparent knee bending when the hip does not move downward', () => {
    // Only knee bend without hip drop should not count
    const counter = createSquatCounter({ targetCount: 5 });

    const apparentBend = (timestampMs: number): PoseFrame => ({
      timestampMs,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        // Knees bent but hips at same height as standing
        landmark('leftShoulder', 90, 100),
        landmark('rightShoulder', 210, 100),
        landmark('leftHip', 110, 240),
        landmark('rightHip', 190, 240),
        landmark('leftKnee', 70, 380),
        landmark('rightKnee', 230, 380),
        landmark('leftAnkle', 120, 560),
        landmark('rightAnkle', 180, 560),
      ],
    });

    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(apparentBend(2000));
    counter.handleFrame(apparentBend(2100));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'ready');
  });

  it('does not count a scale jump from moving closer to the camera as a squat', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    // Standing first
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));

    // Scale jump - person closer to camera (no actual squat)
    const nearCameraPose = (timestampMs: number): PoseFrame => ({
      timestampMs,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        landmark('leftShoulder', 30, 0),
        landmark('rightShoulder', 270, 0),
        landmark('leftHip', 90, 420),
        landmark('rightHip', 210, 420),
        landmark('leftKnee', 0, 580),
        landmark('rightKnee', 300, 580),
        landmark('leftAnkle', 80, 860),
        landmark('rightAnkle', 220, 860),
      ],
    });

    counter.handleFrame(nearCameraPose(2000));
    counter.handleFrame(nearCameraPose(2100));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'ready');
  });

  it('marks the squat challenge complete when the target count is reached', () => {
    const counter = createSquatCounter({ targetCount: 2 });

    stableRep(counter, 1000);
    const result = stableRep(counter, 5000);

    assert.equal(result.count, 2);
    assert.equal(result.isComplete, true);
  });

  it('counts 5 complete squats', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    for (let i = 0; i < 5; i++) {
      const offset = i * 5000;
      counter.handleFrame(fullBodyFrame('standing', 1000 + offset));
      counter.handleFrame(fullBodyFrame('standing', 1100 + offset));
      counter.handleFrame(fullBodyFrame('squatting', 2000 + offset));
      counter.handleFrame(fullBodyFrame('squatting', 2100 + offset));
      counter.handleFrame(fullBodyFrame('standing', 3000 + offset));
      counter.handleFrame(fullBodyFrame('standing', 3100 + offset));
    }

    const result = counter.handleFrame(fullBodyFrame('standing', 26000));

    assert.equal(result.count, 5);
    assert.equal(result.isComplete, true);
  });
});
