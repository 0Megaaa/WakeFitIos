import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateAngle,
  createPushUpCounter,
  type PoseFrame,
  type PoseLandmarkName,
} from './pushupCounter.ts';

type BodySide = 'left' | 'right';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

function frame(
  angle: 'up' | 'down',
  confidence = 0.95,
  side: BodySide = 'left',
  timestampMs = 1000,
): PoseFrame {
  // For proper elbow angle detection with thresholds upAngle=160, downAngle=90:
  // - up position: arm extended, elbow angle = 180° (collinear, elbow in middle)
  // - down position: arm bent, elbow angle < 90° (vectors in same general direction)
  //
  // Geometry (upright coords, y increases downward):
  // shoulder(100, 50), elbow(100, 200)
  // - up: wrist(100, 350) → AB=(0,-150), BC=(0,150) → angle = 180°
  // - down: wrist(150, 100) → AB=(0,-150), BC=(50,-100) → angle = 26.6° (< 90)
  const wrist = angle === 'up'
    ? { x: 100, y: 350 }  // Extended - 180°
    : { x: 150, y: 100 }; // Bent - 26.6°
  const prefix = side === 'left' ? 'left' : 'right';

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      landmark(`${prefix}Shoulder` as PoseLandmarkName, 100, 50, confidence),
      landmark(`${prefix}Elbow` as PoseLandmarkName, 100, 200, confidence),
      landmark(`${prefix}Wrist` as PoseLandmarkName, wrist.x, wrist.y, confidence),
      landmark(`${prefix}Hip` as PoseLandmarkName, 100, 250, confidence),
    ],
  };
}

function stableRep(counter: ReturnType<typeof createPushUpCounter>, side: BodySide = 'left') {
  counter.handleFrame(frame('up', 0.95, side, 1000));
  counter.handleFrame(frame('up', 0.95, side, 1100));
  counter.handleFrame(frame('down', 0.95, side, 2000));
  counter.handleFrame(frame('down', 0.95, side, 2100));
  counter.handleFrame(frame('up', 0.95, side, 3000));
  return counter.handleFrame(frame('up', 0.95, side, 3100));
}describe('push-up counter core', () => {
  it('calculates the elbow angle from shoulder, elbow, and wrist points', () => {
    // Test the angle calculation with valid coordinates
    // shoulder(100, 50), elbow(100, 200), wrist(100, 350)
    // Vectors from elbow: shoulder(0, -150), wrist(0, 150) - collinear
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

    const result = counter.handleFrame(frame('up', 0.2));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.isPoseReady, false);
  });

  it('counts one push-up after an up to down to up transition', () => {
    const counter = createPushUpCounter({ targetCount: 5 });

    const result = stableRep(counter);

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
    assert.equal(result.isComplete, false);
  });

  it('counts a repetition from the right body side when that side is visible', () => {
    const counter = createPushUpCounter({ targetCount: 5 });

    const result = stableRep(counter, 'right');

    assert.equal(result.count, 1);
    assert.equal(result.phase, 'ready');
  });

  it('does not double count repeated up frames after a repetition', () => {
    const counter = createPushUpCounter({ targetCount: 5 });

    stableRep(counter);
    const result = counter.handleFrame(frame('up'));

    assert.equal(result.count, 1);
  });

  it('does not count a one-frame down and up noise spike as a repetition', () => {
    const counter = createPushUpCounter({ targetCount: 5 });

    counter.handleFrame(frame('up', 0.95, 'left', 1000));
    counter.handleFrame(frame('up', 0.95, 'left', 1100));
    counter.handleFrame(frame('down', 0.95, 'left', 1200));
    const result = counter.handleFrame(frame('up', 0.95, 'left', 1300));

    assert.equal(result.count, 0);
    assert.equal(result.phase, 'ready');
  });

  it('clamps a target count below one to one repetition', () => {
    const counter = createPushUpCounter({ targetCount: 0 });

    const initial = counter.reset();
    assert.equal(initial.isComplete, false);

    const result = stableRep(counter);

    assert.equal(result.count, 1);
    assert.equal(result.isComplete, true);
  });

  it('marks the challenge complete when the target count is reached', () => {
    const counter = createPushUpCounter({ targetCount: 2 });

    stableRep(counter);
    const result = stableRep(counter);

    assert.equal(result.count, 2);
    assert.equal(result.isComplete, true);
  });
});
