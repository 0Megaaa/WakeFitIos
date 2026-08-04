import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSquatCounter, type PoseFrame, type PoseLandmarkName } from '../domain/exercise/pushupCounter.ts';

type BodySide = 'left' | 'right';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

function frame(
  pose: 'standing' | 'squatting',
  confidence = 0.95,
  side: BodySide = 'left',
  timestampMs = 1000,
): PoseFrame {
  const prefix = side === 'left' ? 'left' : 'right';
  const hip = pose === 'standing' ? { x: 0, y: -1 } : { x: -1, y: 0 };

  return {
    timestampMs,
    landmarks: [
      landmark(`${prefix}Hip` as PoseLandmarkName, hip.x, hip.y, confidence),
      landmark(`${prefix}Knee` as PoseLandmarkName, 0, 0, confidence),
      landmark(`${prefix}Ankle` as PoseLandmarkName, 0, 1, confidence),
    ],
  };
}

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
        leftHip: { x: 115, y: 330 },
        rightHip: { x: 185, y: 330 },
        leftKnee: { x: 85, y: 410 },
        rightKnee: { x: 215, y: 410 },
        leftAnkle: { x: 120, y: 560 },
        rightAnkle: { x: 180, y: 560 },
      };

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    landmarks: [
      landmark('leftShoulder', 90, pose === 'standing' ? 100 : 130, confidence),
      landmark('rightShoulder', 210, pose === 'standing' ? 100 : 130, confidence),
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
    landmarks: [
      landmark('leftShoulder', 250, 130),
      landmark('rightShoulder', 470, 130),
      landmark('leftHip', 310, 330),
      landmark('rightHip', 410, 330),
      landmark('leftKnee', 250, 410),
      landmark('rightKnee', 470, 410),
      landmark('leftAnkle', 320, 560),
      landmark('rightAnkle', 400, 560),
    ],
  };
}

function lowConfidenceFullBodyFrame(timestampMs: number): PoseFrame {
  return fullBodyFrame('squatting', timestampMs, 0.2);
}

function stableRep(counter: ReturnType<typeof createSquatCounter>, startTimestampMs = 1000) {
  counter.handleFrame(fullBodyFrame('standing', startTimestampMs));
  counter.handleFrame(fullBodyFrame('standing', startTimestampMs + 100));
  counter.handleFrame(fullBodyFrame('squatting', startTimestampMs + 1000));
  counter.handleFrame(fullBodyFrame('squatting', startTimestampMs + 1100));
  counter.handleFrame(fullBodyFrame('standing', startTimestampMs + 2000));
  return counter.handleFrame(fullBodyFrame('standing', startTimestampMs + 2100));
}

function lowerBodyOnlyRep(counter: ReturnType<typeof createSquatCounter>) {
  counter.handleFrame(frame('standing', 0.95, 'left', 1000));
  counter.handleFrame(frame('standing', 0.95, 'left', 1100));
  counter.handleFrame(frame('squatting', 0.95, 'left', 2000));
  counter.handleFrame(frame('squatting', 0.95, 'left', 2100));
  counter.handleFrame(frame('standing', 0.95, 'left', 3000));
  return counter.handleFrame(frame('standing', 0.95, 'left', 3100));
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

  it('counts when the camera first stabilizes while the user is already squatting', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(fullBodyFrame('standing', 2000));
    const result = counter.handleFrame(fullBodyFrame('standing', 2100));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('counts a squat from a single confident down frame between standing frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    const result = counter.handleFrame(fullBodyFrame('standing', 3100));

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('does not count another squat until the user has returned to a stable standing pose', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(lowConfidenceFullBodyFrame(1100));
    counter.handleFrame(lowConfidenceFullBodyFrame(1200));
    counter.handleFrame(lowConfidenceFullBodyFrame(1300));
    counter.handleFrame(lowConfidenceFullBodyFrame(1400));
    counter.handleFrame(lowConfidenceFullBodyFrame(1500));
    const repeatedBottom = counter.handleFrame(fullBodyFrame('squatting', 2300));

    assert.equal(repeatedBottom.count, 1);
    assert.equal(repeatedBottom.phase, 'down');
  });

  it('unlocks the next squat only after stable standing frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(lowConfidenceFullBodyFrame(1100));
    counter.handleFrame(lowConfidenceFullBodyFrame(1200));
    counter.handleFrame(fullBodyFrame('standing', 2000));
    counter.handleFrame(fullBodyFrame('standing', 2100));
    const second = counter.handleFrame(fullBodyFrame('squatting', 3200));

    assert.equal(second.count, 2);
    assert.equal(second.phase, 'down');
  });

  it('does not double count one down episode split by a short tracking gap', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(lowConfidenceFullBodyFrame(1100));
    counter.handleFrame(lowConfidenceFullBodyFrame(1200));
    counter.handleFrame(lowConfidenceFullBodyFrame(1300));
    counter.handleFrame(lowConfidenceFullBodyFrame(1400));
    counter.handleFrame(lowConfidenceFullBodyFrame(1500));
    const repeatedBottom = counter.handleFrame(fullBodyFrame('squatting', 1600));

    assert.equal(repeatedBottom.count, 1);
    assert.equal(repeatedBottom.phase, 'down');
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

  it('does not count a squat when the upper body is not visible', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    const result = lowerBodyOnlyRep(counter);

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });

  it('counts a squat when the hip drops even if the knee angle is moderate', () => {
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

  it('does not count a repetition when only one leg is visible', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    const result = lowerBodyOnlyRep(counter);

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('does not count apparent knee bending when the hip does not move downward', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    const apparentBend = (timestampMs: number): PoseFrame => ({
      timestampMs,
      imageWidth: 300,
      imageHeight: 640,
      landmarks: [
        landmark('leftShoulder', 90, 100),
        landmark('rightShoulder', 210, 100),
        landmark('leftHip', 110, 240),
        landmark('rightHip', 190, 240),
        landmark('leftKnee', 70, 400),
        landmark('rightKnee', 230, 400),
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
    const nearCameraPose = (timestampMs: number): PoseFrame => ({
      timestampMs,
      imageWidth: 300,
      imageHeight: 640,
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

    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
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
});
