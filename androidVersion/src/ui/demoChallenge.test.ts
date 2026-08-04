import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createChallengeFlow } from '../features/challenge.ts';
import { driveOneSimulatedExercise, driveOneSimulatedPushUp } from './demoChallenge.ts';

describe('demo challenge controls', () => {
  it('drives the real challenge flow by one stable simulated push-up', () => {
    const flow = createChallengeFlow({
      alarmId: 1,
      exerciseType: 'push_up',
      targetCount: 2,
      workoutDate: '2026-07-27',
    });

    flow.startRinging();
    flow.beginChallenge();

    const first = driveOneSimulatedPushUp(flow, 1000);
    const second = driveOneSimulatedPushUp(flow, 5000);

    assert.equal(first.count, 1);
    assert.equal(first.status, 'challenge');
    assert.equal(second.count, 2);
    assert.equal(second.status, 'completed');
    assert.equal(second.workout?.actualCount, 2);
  });

  it('drives a squat challenge with simulated full-body frames', () => {
    const flow = createChallengeFlow({
      alarmId: 1,
      exerciseType: 'squat',
      targetCount: 1,
      workoutDate: '2026-07-27',
    });

    flow.startRinging();
    flow.beginChallenge();

    const result = driveOneSimulatedExercise(flow, 'squat', 1000);

    assert.equal(result.count, 1);
    assert.equal(result.status, 'completed');
    assert.equal(result.workout?.exerciseType, 'squat');
  });
});
