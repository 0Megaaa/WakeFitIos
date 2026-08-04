import type { ExerciseType } from '../../domain/alarm/alarm.ts';

export type LocalAlarmScheduleRequest = {
  alarmId: string;
  fireAt: string;
  label?: string;
  timeOfDay?: string;
  targetCount?: number;
  exerciseType?: ExerciseType;
};

export type LocalAlarmScheduler = {
  schedule(request: LocalAlarmScheduleRequest): Promise<void>;
  cancel(alarmId: string): Promise<void>;
};

// Alias for compatibility with application ports
export type AlarmScheduler = LocalAlarmScheduler;

export class MemoryLocalAlarmScheduler implements LocalAlarmScheduler {
  #scheduled = new Map<string, LocalAlarmScheduleRequest>();

  async schedule(request: LocalAlarmScheduleRequest): Promise<void> {
    this.#scheduled.set(request.alarmId, { ...request });
  }

  async cancel(alarmId: string): Promise<void> {
    this.#scheduled.delete(alarmId);
  }

  async getScheduledAlarm(alarmId: string): Promise<LocalAlarmScheduleRequest | null> {
    const request = this.#scheduled.get(alarmId);
    return request ? { ...request } : null;
  }

  async listScheduledAlarms(): Promise<LocalAlarmScheduleRequest[]> {
    return Array.from(this.#scheduled.values(), (request) => ({ ...request }));
  }
}

type DefaultTimerHandle = ReturnType<typeof setTimeout>;

export type ForegroundLocalAlarmSchedulerOptions<TimerHandle = DefaultTimerHandle> = {
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  onFire: (request: LocalAlarmScheduleRequest) => void;
};

export class ForegroundLocalAlarmScheduler<TimerHandle = DefaultTimerHandle> implements LocalAlarmScheduler {
  #scheduled = new Map<string, LocalAlarmScheduleRequest>();
  #timers = new Map<string, TimerHandle>();
  #now: () => number;
  #setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  #clearTimer: (handle: TimerHandle) => void;
  #onFire: (request: LocalAlarmScheduleRequest) => void;

  constructor(options: ForegroundLocalAlarmSchedulerOptions<TimerHandle>) {
    this.#now = options.now ?? Date.now;
    this.#setTimer = options.setTimer ?? (setTimeout as unknown as (callback: () => void, delayMs: number) => TimerHandle);
    this.#clearTimer = options.clearTimer ?? (clearTimeout as (handle: TimerHandle) => void);
    this.#onFire = options.onFire;
  }

  async schedule(request: LocalAlarmScheduleRequest): Promise<void> {
    await this.cancel(request.alarmId);

    const nextRequest = { ...request };
    this.#scheduled.set(request.alarmId, nextRequest);

    const delayMs = Math.max(0, new Date(request.fireAt).getTime() - this.#now());
    const handle = this.#setTimer(() => {
      this.#timers.delete(request.alarmId);
      this.#scheduled.delete(request.alarmId);
      this.#onFire({ ...nextRequest });
    }, delayMs);
    this.#timers.set(request.alarmId, handle);
  }

  async cancel(alarmId: string): Promise<void> {
    const handle = this.#timers.get(alarmId);
    if (handle !== undefined) {
      this.#clearTimer(handle);
      this.#timers.delete(alarmId);
    }
    this.#scheduled.delete(alarmId);
  }

  async getScheduledAlarm(alarmId: string): Promise<LocalAlarmScheduleRequest | null> {
    const request = this.#scheduled.get(alarmId);
    return request ? { ...request } : null;
  }

  async listScheduledAlarms(): Promise<LocalAlarmScheduleRequest[]> {
    return Array.from(this.#scheduled.values(), (request) => ({ ...request }));
  }
}
