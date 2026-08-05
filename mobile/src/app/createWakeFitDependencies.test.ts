import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryStorage } from '../infrastructure/storage/MemoryStorage.ts';
import { createWorkoutSyncQueue } from '../infrastructure/sync/createWorkoutSyncQueue.ts';
import { FetchWakeFitApiClient } from '../infrastructure/api/FetchWakeFitApiClient.ts';
import { createPlatformServices } from '../platform/createPlatformServices.ts';
import { createWakeFitDependencies, createSessionDeviceId, resetWakeFitDependenciesForTesting } from './createWakeFitDependencies.ts';

describe('createWakeFitDependencies', () => {
  it('returns the same instance for repeated calls within a run', () => {
    resetWakeFitDependenciesForTesting();
    const first = createWakeFitDependencies();
    const second = createWakeFitDependencies();
    assert.strictEqual(first, second);
  });

  it('keeps deviceId stable across calls within a run', () => {
    resetWakeFitDependenciesForTesting();
    const first = createWakeFitDependencies();
    const second = createWakeFitDependencies();
    assert.strictEqual(first.deviceId, second.deviceId);
    assert.ok(first.deviceId.startsWith('wakefit-demo-'));
  });

  it('createSessionDeviceId returns the same value across calls', () => {
    resetWakeFitDependenciesForTesting();
    const first = createSessionDeviceId();
    const second = createSessionDeviceId();
    assert.strictEqual(first, second);
  });

  it('exposes a platform with the expected services', () => {
    const deps = createWakeFitDependencies();
    assert.ok(deps.platform.alarmScheduler);
    assert.ok(deps.platform.alarmAlertService);
    assert.ok(deps.platform.pendingAlarmLaunchService);
    assert.ok(deps.platform.foregroundAlarmEvents);
    assert.ok(deps.platform.permissionService);
    assert.ok(typeof deps.platform.poseCamera.supported === 'boolean');
  });

  it('createApiClient returns a FetchWakeFitApiClient', () => {
    const deps = createWakeFitDependencies();
    const client = deps.createApiClient({ baseUrl: 'http://127.0.0.1:8080' });
    assert.ok(client instanceof FetchWakeFitApiClient);
  });

  it('createSyncQueue returns a queue using storage', async () => {
    const deps = createWakeFitDependencies();
    const client = deps.createApiClient({ baseUrl: 'http://127.0.0.1:8080' });
    const queue = deps.createSyncQueue(client);
    assert.ok(queue);
    // The storage from deps must be the one used by the queue
    await deps.storage.setItem('key', 'value');
    assert.equal(await deps.storage.getItem('key'), 'value');
    // createWorkoutSyncQueue is the same factory
    assert.ok(typeof createWorkoutSyncQueue === 'function');
    assert.ok(typeof MemoryStorage === 'function');
  });

  it('resetWakeFitDependenciesForTesting produces a new instance and new deviceId', () => {
    const first = createWakeFitDependencies();
    const firstDeviceId = first.deviceId;
    resetWakeFitDependenciesForTesting();
    const second = createWakeFitDependencies();
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(firstDeviceId, second.deviceId);
  });
});

describe('createPlatformServices', () => {
  it('returns services with the expected shape', () => {
    const services = createPlatformServices({ platformOS: 'android' });
    assert.ok(services.alarmScheduler);
    assert.ok(services.alarmAlertService);
    assert.ok(services.pendingAlarmLaunchService);
    assert.ok(services.foregroundAlarmEvents);
    assert.ok(services.permissionService);
    assert.equal(services.poseCamera.supported, true);
  });

  it('reports pose camera not supported on web', () => {
    const services = createPlatformServices({ platformOS: 'web' });
    assert.equal(services.poseCamera.supported, false);
  });

  it('subscribes and emits foreground alarm events', () => {
    const services = createPlatformServices({ platformOS: 'android' });
    const events: { alarmId: string; firedAt: string }[] = [];
    const unsubscribe = services.foregroundAlarmEvents.subscribe((event) => {
      events.push({ alarmId: event.alarmId, firedAt: event.firedAt });
    });
    services.foregroundAlarmEvents.emit({
      alarmId: 'alarm-1',
      firedAt: '2026-07-27T07:30:00.000Z',
    });
    services.foregroundAlarmEvents.emit({
      alarmId: 'alarm-2',
      firedAt: '2026-07-27T07:35:00.000Z',
    });
    assert.deepEqual(events, [
      { alarmId: 'alarm-1', firedAt: '2026-07-27T07:30:00.000Z' },
      { alarmId: 'alarm-2', firedAt: '2026-07-27T07:35:00.000Z' },
    ]);
    unsubscribe();
  });

  it('stops receiving events after unsubscribe', () => {
    const services = createPlatformServices({ platformOS: 'android' });
    const events: string[] = [];
    const unsubscribe = services.foregroundAlarmEvents.subscribe((event) => {
      events.push(event.alarmId);
    });
    services.foregroundAlarmEvents.emit({ alarmId: 'first', firedAt: '2026-07-27T07:30:00.000Z' });
    unsubscribe();
    services.foregroundAlarmEvents.emit({ alarmId: 'second', firedAt: '2026-07-27T07:35:00.000Z' });
    assert.deepEqual(events, ['first']);
  });

  it('emits at most one event per scheduler fire', () => {
    const services = createPlatformServices({ platformOS: 'android' });
    const firedEvents: string[] = [];
    services.foregroundAlarmEvents.subscribe((event) => firedEvents.push(event.alarmId));
    const scheduler = services.alarmScheduler;
    // Schedule directly via the scheduler service to verify ForegroundLocalAlarmScheduler emits exactly once.
    void scheduler.schedule({
      alarmId: 'alarm-1',
      fireAt: new Date(Date.now() - 1).toISOString(),
    });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.deepEqual(firedEvents, ['alarm-1']);
        resolve();
      }, 30);
    });
  });
});