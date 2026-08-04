import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateAngle,
  createPushUpCounter,
  type PoseFrame,
  type PoseLandmarkName,
} from '../domain/exercise/pushupCounter.ts';

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
  const wrist = angle === 'up' ? { x: 1, y: 0 } : { x: -0.2, y: -1 };
  const prefix = side === 'left' ? 'left' : 'right';

  return {
    timestampMs,
    landmarks: [
      landmark(`${prefix}Shoulder` as PoseLandmarkName, -1, 0, confidence),
      landmark(`${prefix}Elbow` as PoseLandmarkName, 0, 0, confidence),
      landmark(`${prefix}Wrist` as PoseLandmarkName, wrist.x, wrist.y, confidence),
      landmark(`${prefix}Hip` as PoseLandmarkName, -1.1, 1, confidence),
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
}

describe('push-up counter core', () => {
  it('calculates the elbow angle from shoulder, elbow, and wrist points', () => {
    const angle = calculateAngle(
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -1 },
    );

    assert.equal(Math.round(angle), 90);
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
