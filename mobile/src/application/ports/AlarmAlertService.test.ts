import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAlarmAlertController } from './AlarmAlertService.ts';

describe('alarm alert controller', () => {
  it('starts native tone, vibration, and fallback sound loop once', async () => {
    const calls: string[] = [];
    const timers = new FakeIntervals();
    const alert = createAlarmAlertController({
      startNativeTone: async () => calls.push('startNativeTone'),
      stopNativeTone: async () => calls.push('stopNativeTone'),
      startVibration: () => calls.push('startVibration'),
      stopVibration: () => calls.push('stopVibration'),
      playFallbackSound: () => calls.push('playFallbackSound'),
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      fallbackIntervalMs: 1000,
    });

    await alert.start();
    await alert.start();

    assert.equal(alert.isRunning(), true);
    assert.equal(timers.pendingCount(), 1);
    assert.deepEqual(calls, ['startNativeTone', 'startVibration', 'playFallbackSound']);

    timers.fireAll();

    assert.deepEqual(calls, ['startNativeTone', 'startVibration', 'playFallbackSound', 'playFallbackSound']);
  });

  it('stops native tone, vibration, and fallback sound loop', async () => {
    const calls: string[] = [];
    const timers = new FakeIntervals();
    const alert = createAlarmAlertController({
      startNativeTone: async () => calls.push('startNativeTone'),
      stopNativeTone: async () => calls.push('stopNativeTone'),
      startVibration: () => calls.push('startVibration'),
      stopVibration: () => calls.push('stopVibration'),
      playFallbackSound: () => calls.push('playFallbackSound'),
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      fallbackIntervalMs: 1000,
    });

    await alert.start();
    await alert.stop();

    assert.equal(alert.isRunning(), false);
    assert.equal(timers.pendingCount(), 0);
    assert.deepEqual(calls, [
      'startNativeTone',
      'startVibration',
      'playFallbackSound',
      'stopNativeTone',
      'stopVibration',
    ]);
  });
});

class FakeIntervals {
  #nextHandle = 1;
  #callbacks = new Map<number, () => void>();

  setInterval = (callback: () => void): number => {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#callbacks.set(handle, callback);
    return handle;
  };

  clearInterval = (handle: number): void => {
    this.#callbacks.delete(handle);
  };

  pendingCount(): number {
    return this.#callbacks.size;
  }

  fireAll(): void {
    for (const callback of this.#callbacks.values()) {
      callback();
    }
  }
}
