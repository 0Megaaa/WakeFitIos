type DefaultIntervalHandle = ReturnType<typeof setInterval>;

export type AlarmAlertController = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
};

export type AlarmAlertControllerOptions<IntervalHandle = DefaultIntervalHandle> = {
  startNativeTone?: () => void | Promise<unknown>;
  stopNativeTone?: () => void | Promise<unknown>;
  startVibration?: () => void;
  stopVibration?: () => void;
  playFallbackSound?: () => void;
  setInterval?: (callback: () => void, intervalMs: number) => IntervalHandle;
  clearInterval?: (handle: IntervalHandle) => void;
  fallbackIntervalMs?: number;
};

export function createAlarmAlertController<IntervalHandle = DefaultIntervalHandle>(
  options: AlarmAlertControllerOptions<IntervalHandle> = {},
): AlarmAlertController {
  const startNativeTone = options.startNativeTone ?? noopAsync;
  const stopNativeTone = options.stopNativeTone ?? noopAsync;
  const startVibration = options.startVibration ?? noop;
  const stopVibration = options.stopVibration ?? noop;
  const playFallbackSound = options.playFallbackSound ?? noop;
  const setRepeatingSound = options.setInterval ?? (setInterval as unknown as (callback: () => void, intervalMs: number) => IntervalHandle);
  const clearRepeatingSound = options.clearInterval ?? (clearInterval as (handle: IntervalHandle) => void);
  const fallbackIntervalMs = options.fallbackIntervalMs ?? 1400;
  let running = false;
  let fallbackSoundTimer: IntervalHandle | null = null;

  return {
    async start(): Promise<void> {
      if (running) {
        return;
      }

      running = true;
      await startNativeTone();
      startVibration();
      playFallbackSound();
      fallbackSoundTimer = setRepeatingSound(playFallbackSound, fallbackIntervalMs);
    },

    async stop(): Promise<void> {
      if (!running) {
        return;
      }

      running = false;
      if (fallbackSoundTimer !== null) {
        clearRepeatingSound(fallbackSoundTimer);
        fallbackSoundTimer = null;
      }
      await stopNativeTone();
      stopVibration();
    },

    isRunning(): boolean {
      return running;
    },
  };
}

function noop(): void {
  // Intentionally empty.
}

async function noopAsync(): Promise<void> {
  // Intentionally empty.
}
