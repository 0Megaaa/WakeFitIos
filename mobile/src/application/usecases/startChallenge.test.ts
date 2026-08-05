import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startChallenge } from './startChallenge.ts';
import { createChallengeFlow } from '../../domain/challenge/challengeFlow.ts';

describe('startChallenge use case', () => {
  it('creates a Challenge Flow through the Domain layer', () => {
    const flow = startChallenge({
      alarmId: 1,
      targetCount: 3,
      exerciseType: 'squat',
      workoutDate: '2026-07-27',
    });

    assert.strictEqual(typeof flow.startRinging, 'function');
    assert.strictEqual(typeof flow.beginChallenge, 'function');
    assert.strictEqual(typeof flow.handlePoseFrame, 'function');
    assert.equal(flow.getSnapshot().targetCount, 3);
    assert.equal(flow.getSnapshot().exerciseType, 'squat');
  });

  it('produces a flow that matches createChallengeFlow', () => {
    const useCaseFlow = startChallenge({
      alarmId: 1,
      targetCount: 1,
      workoutDate: '2026-07-27',
    });
    const directFlow = createChallengeFlow({
      alarmId: 1,
      targetCount: 1,
      workoutDate: '2026-07-27',
    });
    assert.equal(useCaseFlow.getSnapshot().alarmId, directFlow.getSnapshot().alarmId);
    assert.equal(useCaseFlow.getSnapshot().exerciseType, directFlow.getSnapshot().exerciseType);
  });

  it('does not import react, react-native, platform, or infrastructure', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./startChallenge.ts', import.meta.url), 'utf-8'),
    );
    assert.equal(source.includes('react'), false);
    assert.equal(source.includes('react-native'), false);
    assert.equal(source.includes('platform'), false);
    assert.equal(source.includes('infrastructure'), false);
  });
});