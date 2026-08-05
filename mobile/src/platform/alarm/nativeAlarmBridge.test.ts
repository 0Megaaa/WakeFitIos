import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMirroredLocalAlarmScheduler, createNativeLocalAlarmScheduler, consumePendingAlarmLaunch } from './nativeAlarmBridge.ts';

describe('native alarm bridge', () => {
  it('schedules Android alarms with the data needed to start the challenge after launch', async () => {
    const calls: unknown[][] = [];
    const scheduler = createNativeLocalAlarmScheduler({
      async scheduleAlarm(...args: unknown[]) {
        calls.push(args);
      },
      async cancelAlarm() {
        throw new Error('not used');
      },
    });

    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-27T07:30:00.000Z',
      label: '晨间训练',
      timeOfDay: '07:30',
      targetCount: 12,
      exerciseType: 'squat',
    });

    assert.deepEqual(calls, [[
      'alarm-1',
      Date.parse('2026-07-27T07:30:00.000Z'),
      '晨间训练',
      '07:30',
      12,
      'squat',
    ]]);
  });

  it('uses squat when scheduling a native alarm without an explicit exercise type', async () => {
    const calls: unknown[][] = [];
    const scheduler = createNativeLocalAlarmScheduler({
      async scheduleAlarm(...args: unknown[]) {
        calls.push(args);
      },
      async cancelAlarm() {
        throw new Error('not used');
      },
    });

    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-27T07:30:00.000Z',
      targetCount: 12,
    });

    assert.equal(calls[0]?.[5], 'squat');
  });

  it('cancels Android alarms by alarm id', async () => {
    const canceled: string[] = [];
    const scheduler = createNativeLocalAlarmScheduler({
      async scheduleAlarm() {
        throw new Error('not used');
      },
      async cancelAlarm(alarmId: string) {
        canceled.push(alarmId);
      },
    });

    await scheduler.cancel('alarm-1');

    assert.deepEqual(canceled, ['alarm-1']);
  });

  it('mirrors schedules and cancels to a foreground fallback scheduler', async () => {
    const calls: string[] = [];
    const scheduler = createMirroredLocalAlarmScheduler(
      {
        async schedule(request) {
          calls.push(`native:${request.alarmId}`);
        },
        async cancel(alarmId) {
          calls.push(`native-cancel:${alarmId}`);
        },
      },
      {
        async schedule(request) {
          calls.push(`fallback:${request.alarmId}`);
        },
        async cancel(alarmId) {
          calls.push(`fallback-cancel:${alarmId}`);
        },
      },
    );

    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-27T07:30:00.000Z',
      label: '晨间训练',
      timeOfDay: '07:30',
      targetCount: 12,
      exerciseType: 'squat',
    });
    await scheduler.cancel('alarm-1');

    assert.deepEqual(calls, [
      'native:alarm-1',
      'fallback:alarm-1',
      'native-cancel:alarm-1',
      'fallback-cancel:alarm-1',
    ]);
  });

  it('normalizes a pending alarm launch from native extras', async () => {
    const launch = await consumePendingAlarmLaunch({
      async consumePendingAlarmLaunch() {
        return {
          alarmId: 'alarm-1',
          firedAt: '2026-07-27T07:30:00.000Z',
          label: '晨间训练',
          timeOfDay: '07:30',
          targetCount: 12,
          exerciseType: 'squat',
        };
      },
    });

    assert.deepEqual(launch, {
      alarmId: 'alarm-1',
      firedAt: '2026-07-27T07:30:00.000Z',
      label: '晨间训练',
      timeOfDay: '07:30',
      targetCount: 12,
      exerciseType: 'squat',
    });
  });

  it('defaults a pending alarm launch without exercise extras to squat', async () => {
    const launch = await consumePendingAlarmLaunch({
      async consumePendingAlarmLaunch() {
        return {
          alarmId: 'alarm-1',
          firedAt: '2026-07-27T07:30:00.000Z',
          targetCount: 12,
        };
      },
    });

    assert.equal(launch?.exerciseType, 'squat');
  });
});
