import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAlarmConfig, updateAlarmConfig } from '../domain/alarm/alarm.ts';
import { FetchWakeFitApiClient, MemoryStorage } from '../infrastructure/index.ts';
import { createAppSession, createWorkoutSyncQueue } from '../infrastructure/index.ts';
import { createChallengeFlow } from '../domain/challenge/challengeFlow.ts';
import { ForegroundLocalAlarmScheduler, MemoryLocalAlarmScheduler } from '../platform/alarm/ForegroundLocalAlarmScheduler.ts';
import type { ApiAlarm, ApiWorkoutUpload } from '../infrastructure/api/types.ts';
import type { PoseFrame, PoseLandmarkName } from '../domain/exercise/types.ts';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

function pushUpFrame(
  angle: 'up' | 'down',
  timestampMs: number,
  confidence = 0.95,
): PoseFrame {
  const wrist = angle === 'up' ? { x: 1, y: 0 } : { x: -0.2, y: -1 };

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      landmark('leftShoulder', -1, 0, confidence),
      landmark('leftElbow', 0, 0, confidence),
      landmark('leftWrist', wrist.x, wrist.y, confidence),
      landmark('leftHip', -1.1, 1, confidence),
    ],
  };
}

function squatFrame(
  pose: 'standing' | 'squatting',
  timestampMs: number,
  confidence = 0.95,
): PoseFrame {
  // Create proper standing and deep squat fixtures
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
        // Squat: knee very forward, hip lower
        // Must have averageKneeAngle < 140 (strictly) to pass classifier
        // Use knees at x=0/300 (very forward) for clear squat
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

function driveOneStablePushUp(flow: ReturnType<typeof createChallengeFlow>) {
  flow.handlePoseFrame(pushUpFrame('up', 1000));
  flow.handlePoseFrame(pushUpFrame('up', 1100));
  flow.handlePoseFrame(pushUpFrame('down', 2000));
  flow.handlePoseFrame(pushUpFrame('down', 2100));
  flow.handlePoseFrame(pushUpFrame('up', 3000));
  return flow.handlePoseFrame(pushUpFrame('up', 3100));
}

function driveOneStableSquat(flow: ReturnType<typeof createChallengeFlow>) {
  // Need 3 stable standing frames to establish baseline
  flow.handlePoseFrame(squatFrame('standing', 1000));
  flow.handlePoseFrame(squatFrame('standing', 1100));
  flow.handlePoseFrame(squatFrame('standing', 1200));
  // Squat (3 frames for stable)
  flow.handlePoseFrame(squatFrame('squatting', 2000));
  flow.handlePoseFrame(squatFrame('squatting', 2100));
  flow.handlePoseFrame(squatFrame('squatting', 2200));
  // Return to standing (4 frames for stable)
  flow.handlePoseFrame(squatFrame('standing', 3000));
  flow.handlePoseFrame(squatFrame('standing', 3100));
  flow.handlePoseFrame(squatFrame('standing', 3200));
  return flow.handlePoseFrame(squatFrame('standing', 3300));
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe('alarm configuration state', () => {
  it('creates a local alarm with a clamped target and squat exercise default', () => {
    const alarm = createAlarmConfig({
      id: 'alarm-1',
      serverId: 9,
      label: 'Morning',
      timeOfDay: '07:30',
      timezone: 'Asia/Shanghai',
      targetCount: 150,
    });

    assert.equal(alarm.id, 'alarm-1');
    assert.equal(alarm.serverId, 9);
    assert.equal(alarm.enabled, true);
    assert.equal(alarm.timezone, 'Asia/Shanghai');
    assert.equal(alarm.exerciseType, 'squat');
    assert.equal(alarm.targetCount, 100);
  });

  it('updates an existing local alarm while keeping target count in the supported range', () => {
    const alarm = createAlarmConfig({
      id: 'alarm-1',
      label: 'Morning',
      timeOfDay: '07:30',
      timezone: 'Asia/Shanghai',
      targetCount: 20,
    });

    const updated = updateAlarmConfig(alarm, {
      serverId: 10,
      enabled: false,
      targetCount: 0,
      timeOfDay: '08:15',
      timezone: 'America/New_York',
    });

    assert.equal(updated.id, 'alarm-1');
    assert.equal(updated.serverId, 10);
    assert.equal(updated.enabled, false);
    assert.equal(updated.timeOfDay, '08:15');
    assert.equal(updated.timezone, 'America/New_York');
    assert.equal(updated.targetCount, 1);
    assert.equal(updated.exerciseType, 'squat');
  });

  it('supports selecting squat as the alarm exercise', () => {
    const alarm = createAlarmConfig({
      id: 'alarm-1',
      timeOfDay: '07:30',
      timezone: 'Asia/Shanghai',
      exerciseType: 'squat',
      targetCount: 12,
    });

    assert.equal(alarm.exerciseType, 'squat');
    assert.equal(alarm.targetCount, 12);
  });
});

describe('app session orchestration', () => {
  it('creates and persists a guest session on first launch', async () => {
    const storage = new MemoryStorage();
    let loginCalls = 0;
    const session = createAppSession({
      storage,
      deviceId: 'device-1',
      apiClient: {
        async guestLogin(input) {
          loginCalls += 1;
          assert.deepEqual(input, { deviceId: 'device-1' });
          return { token: 'guest-token', userId: 1 };
        },
        async fetchStreak() {
          throw new Error('not used');
        },
        async fetchCalendar() {
          throw new Error('not used');
        },
      },
    });

    assert.deepEqual(await session.ensureGuestSession(), { token: 'guest-token', userId: 1 });
    assert.deepEqual(await session.ensureGuestSession(), { token: 'guest-token', userId: 1 });
    assert.equal(await session.getToken(), 'guest-token');
    assert.equal(loginCalls, 1);
  });

  it('refreshes streak and calendar after sync', async () => {
    const storage = new MemoryStorage();
    const session = createAppSession({
      storage,
      deviceId: 'device-1',
      apiClient: {
        async guestLogin() {
          return { token: 'guest-token', userId: 1 };
        },
        async fetchStreak() {
          return { currentDays: 3, longestDays: 7, lastCompletedDate: '2026-07-27' };
        },
        async fetchCalendar(input) {
          assert.deepEqual(input, { month: '2026-07' });
          return { workouts: [] };
        },
      },
    });

    const dashboard = await session.refreshDashboard({ month: '2026-07' });

    assert.equal(dashboard.streak.currentDays, 3);
    assert.deepEqual(dashboard.calendar, { workouts: [] });
  });
});

describe('challenge flow state', () => {
  it('moves from idle to ringing to challenge and completes at the target push-up count', () => {
    const flow = createChallengeFlow({
      alarmId: 1,
      exerciseType: 'push_up',
      targetCount: 1,
      startedAt: '2026-07-27T06:30:00.000Z',
      workoutDate: '2026-07-27',
    });

    assert.equal(flow.getSnapshot().status, 'idle');
    assert.equal(flow.startRinging().status, 'ringing');
    assert.equal(flow.beginChallenge().status, 'challenge');

    const completed = driveOneStablePushUp(flow);

    assert.equal(completed.status, 'completed');
    assert.equal(completed.count, 1);
    assert.equal(completed.workout?.alarmId, 1);
    assert.equal(completed.workout?.exerciseType, 'push_up');
    assert.equal(completed.workout?.targetCount, 1);
    assert.equal(completed.workout?.actualCount, 1);
    assert.equal(completed.workout?.workoutDate, '2026-07-27');
  });

  it('uses the squat counter when the challenge exercise is squat', () => {
    const flow = createChallengeFlow({
      alarmId: 1,
      exerciseType: 'squat',
      targetCount: 1,
      startedAt: '2026-07-27T06:30:00.000Z',
      workoutDate: '2026-07-27',
    });

    flow.startRinging();
    flow.beginChallenge();
    const completed = driveOneStableSquat(flow);

    assert.equal(completed.count, 1, `count should be 1 but got ${completed.count}, status=${completed.status}`);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.workout?.exerciseType, 'squat');
    assert.equal(completed.workout?.actualCount, 1);
  });


  it('uses the explicit local workout date instead of deriving it from UTC completion time', () => {
    const flow = createChallengeFlow({
      alarmId: 1,
      exerciseType: 'push_up',
      targetCount: 1,
      startedAt: '2026-07-26T23:00:00.000Z',
      workoutDate: '2026-07-27',
    });

    flow.startRinging();
    flow.beginChallenge();
    const completed = driveOneStablePushUp(flow);

    assert.equal(completed.workout?.workoutDate, '2026-07-27');
  });

  it('ignores pose frames until the challenge has started', () => {
    const flow = createChallengeFlow({ alarmId: 1, targetCount: 1, workoutDate: '2026-07-27' });

    const snapshot = driveOneStablePushUp(flow);

    assert.equal(snapshot.status, 'idle');
    assert.equal(snapshot.count, 0);
    assert.equal(snapshot.workout, null);
  });
});

describe('memory storage adapter', () => {
  it('stores, reads, removes, and clears string values', async () => {
    const storage = new MemoryStorage();

    await storage.setItem('queued-workouts', JSON.stringify([{ id: 'workout-1' }]));
    assert.equal(await storage.getItem('queued-workouts'), '[{"id":"workout-1"}]');

    await storage.removeItem('queued-workouts');
    assert.equal(await storage.getItem('queued-workouts'), null);

    await storage.setItem('a', '1');
    await storage.setItem('b', '2');
    await storage.clear();
    assert.equal(await storage.getItem('a'), null);
    assert.equal(await storage.getItem('b'), null);
  });
});

describe('fetch API client', () => {
  it('sends guest login, alarm CRUD, workout upload, streak, and calendar requests', async () => {
    const calls: { url: string; method: string; body: unknown; authorization: string | null }[] = [];
    const alarm: ApiAlarm = {
      id: 1,
      localAlarmId: 'alarm-1',
      timeOfDay: '07:30',
      timezone: 'Asia/Shanghai',
      enabled: true,
      targetCount: 10,
      exerciseType: 'push_up',
    };
    const workout: ApiWorkoutUpload = {
      id: 'workout-1',
      alarmId: 1,
      workoutDate: '2026-07-27',
      exerciseType: 'push_up',
      targetCount: 10,
      actualCount: 10,
      completed: true,
      startedAt: '2026-07-27T07:30:00.000Z',
      completedAt: '2026-07-27T07:31:00.000Z',
    };
    const responses = [
      { token: 'guest-token', user: { id: 1 } },
      { alarms: [alarm] },
      { alarm },
      { alarm: { ...alarm, targetCount: 12 } },
      { ok: true },
      { workout: { id: 1 } },
      { currentDays: 3, longestDays: 7, lastCompletedDate: '2026-07-27' },
      {
        workouts: [
          {
            id: 1,
            alarmId: 1,
            workoutDate: '2026-07-27',
            exerciseType: 'push_up',
            targetCount: 10,
            actualCount: 10,
            completed: true,
          },
        ],
      },
    ];
    const client = new FetchWakeFitApiClient({
      baseUrl: 'https://api.example.test',
      getAuthToken: () => 'guest-token',
      fetch: async (url, init = {}) => {
        const headers = init.headers ?? {};
        calls.push({
          url: String(url),
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(String(init.body)) : null,
          authorization: headers.Authorization ?? null,
        });
        return jsonResponse(responses.shift());
      },
    });

    await client.guestLogin({ deviceId: 'device-1' });
    await client.listAlarms();
    await client.createAlarm(alarm);
    await client.updateAlarm(1, { ...alarm, targetCount: 12 });
    await client.deleteAlarm(1);
    await client.uploadWorkout(workout);
    await client.fetchStreak();
    await client.fetchCalendar({ month: '2026-07' });

    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ['POST', 'https://api.example.test/api/v1/auth/guest'],
      ['GET', 'https://api.example.test/api/v1/alarms'],
      ['POST', 'https://api.example.test/api/v1/alarms'],
      ['PUT', 'https://api.example.test/api/v1/alarms/1'],
      ['DELETE', 'https://api.example.test/api/v1/alarms/1'],
      ['POST', 'https://api.example.test/api/v1/workouts'],
      ['GET', 'https://api.example.test/api/v1/streak'],
      ['GET', 'https://api.example.test/api/v1/workouts/calendar?month=2026-07'],
    ]);
    assert.deepEqual(calls[0].body, { deviceId: 'device-1' });
    assert.equal(calls[1].authorization, 'Bearer guest-token');
    assert.deepEqual(calls[3].body, { ...alarm, targetCount: 12 });
    assert.deepEqual(calls[5].body, workout);
  });

  it('throws a useful error when the server returns a non-2xx response', async () => {
    const client = new FetchWakeFitApiClient({
      baseUrl: 'https://api.example.test',
      fetch: async () => jsonResponse({ message: 'nope' }, 500),
    });

    await assert.rejects(() => client.listAlarms(), /returned 500: nope/);
  });
});

describe('workout sync queue', () => {
  it('keeps a workout offline and flushes it when upload succeeds', async () => {
    const storage = new MemoryStorage();
    const uploaded: ApiWorkoutUpload[] = [];
    let online = false;
    const workout: ApiWorkoutUpload = {
      id: 'workout-1',
      alarmId: 1,
      exerciseType: 'push_up',
      targetCount: 10,
      actualCount: 10,
      completed: true,
      workoutDate: '2026-07-27',
      startedAt: '2026-07-27T07:30:00.000Z',
      completedAt: '2026-07-27T07:31:00.000Z',
    };
    const queue = createWorkoutSyncQueue({
      storage,
      apiClient: {
        async uploadWorkout(item) {
          if (!online) {
            throw new Error('offline');
          }
          uploaded.push(item);
          return { id: 1 };
        },
      },
    });

    const queued = await queue.recordWorkout(workout);
    assert.equal(queued.uploaded, false);
    assert.deepEqual(await queue.getQueuedWorkouts(), [workout]);

    online = true;
    const flushed = await queue.flush();

    assert.equal(flushed.uploadedCount, 1);
    assert.deepEqual(uploaded, [workout]);
    assert.deepEqual(await queue.getQueuedWorkouts(), []);
  });

  it('removes a previously queued workout when a later upload succeeds', async () => {
    const storage = new MemoryStorage();
    let online = false;
    const workout: ApiWorkoutUpload = {
      id: 'workout-1',
      alarmId: 1,
      exerciseType: 'push_up',
      targetCount: 10,
      actualCount: 10,
      completed: true,
      workoutDate: '2026-07-27',
      startedAt: '2026-07-27T07:30:00.000Z',
      completedAt: '2026-07-27T07:31:00.000Z',
    };
    const queue = createWorkoutSyncQueue({
      storage,
      apiClient: {
        async uploadWorkout(item) {
          if (!online) {
            throw new Error('offline');
          }
          return { id: 1 };
        },
      },
    });

    await queue.recordWorkout(workout);
    online = true;
    await queue.recordWorkout(workout);

    assert.deepEqual(await queue.getQueuedWorkouts(), []);
  });

  it('serializes concurrent offline queue writes so workouts are not lost', async () => {
    const storage = new MemoryStorage();
    const queue = createWorkoutSyncQueue({
      storage,
      apiClient: {
        async uploadWorkout() {
          throw new Error('offline');
        },
      },
    });

    const first: ApiWorkoutUpload = {
      id: 'workout-1',
      alarmId: 1,
      exerciseType: 'push_up',
      targetCount: 10,
      actualCount: 10,
      completed: true,
      workoutDate: '2026-07-27',
      startedAt: '2026-07-27T07:30:00.000Z',
      completedAt: '2026-07-27T07:31:00.000Z',
    };
    const second: ApiWorkoutUpload = {
      ...first,
      id: 'workout-2',
      workoutDate: '2026-07-28',
    };

    await Promise.all([queue.recordWorkout(first), queue.recordWorkout(second)]);

    assert.deepEqual(
      (await queue.getQueuedWorkouts()).map((item) => item.id).sort(),
      ['workout-1', 'workout-2'],
    );
  });
});

describe('memory local alarm scheduler', () => {
  it('schedules and cancels local alarm requests by alarm id', async () => {
    const scheduler = new MemoryLocalAlarmScheduler();

    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-28T07:30:00.000Z',
      label: 'Morning',
    });

    assert.deepEqual(await scheduler.getScheduledAlarm('alarm-1'), {
      alarmId: 'alarm-1',
      fireAt: '2026-07-28T07:30:00.000Z',
      label: 'Morning',
    });

    await scheduler.cancel('alarm-1');

    assert.equal(await scheduler.getScheduledAlarm('alarm-1'), null);
  });
});

describe('foreground local alarm scheduler', () => {
  it('fires a scheduled alarm when its fire time is due', async () => {
    const timers = new FakeTimers();
    const fired: string[] = [];
    const scheduler = new ForegroundLocalAlarmScheduler({
      now: () => new Date('2026-07-27T06:59:30.000Z').getTime(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      onFire: (request) => fired.push(`${request.alarmId}:${request.fireAt}`),
    });

    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-27T07:00:00.000Z',
      label: 'Morning',
    });

    assert.equal(timers.pendingCount(), 1);
    assert.deepEqual(fired, []);

    timers.fireNext();

    assert.deepEqual(fired, ['alarm-1:2026-07-27T07:00:00.000Z']);
    assert.equal(await scheduler.getScheduledAlarm('alarm-1'), null);
  });

  it('cancels the previous timer when the same alarm is rescheduled', async () => {
    const timers = new FakeTimers();
    const fired: string[] = [];
    const scheduler = new ForegroundLocalAlarmScheduler({
      now: () => new Date('2026-07-27T06:59:30.000Z').getTime(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      onFire: (request) => fired.push(request.fireAt),
    });

    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-27T07:00:00.000Z',
    });
    await scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: '2026-07-27T07:05:00.000Z',
    });

    assert.equal(timers.pendingCount(), 1);

    timers.fireNext();

    assert.deepEqual(fired, ['2026-07-27T07:05:00.000Z']);
  });
});

class FakeTimers {
  #nextHandle = 1;
  #callbacks = new Map<number, () => void>();

  setTimer = (callback: () => void): number => {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#callbacks.set(handle, callback);
    return handle;
  };

  clearTimer = (handle: number): void => {
    this.#callbacks.delete(handle);
  };

  pendingCount(): number {
    return this.#callbacks.size;
  }

  fireNext(): void {
    const [handle, callback] = this.#callbacks.entries().next().value as [number, () => void];
    this.#callbacks.delete(handle);
    callback();
  }
}
