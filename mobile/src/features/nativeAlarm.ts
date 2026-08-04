import { DEFAULT_EXERCISE_TYPE, normalizeTargetCount, type ExerciseType } from './alarms.ts';
import type { LocalAlarmScheduler, LocalAlarmScheduleRequest } from './localAlarm.ts';

export type NativeAlarmLaunch = {
  alarmId: string;
  firedAt: string;
  label: string;
  timeOfDay: string;
  targetCount: number;
  exerciseType: ExerciseType;
};

export type NativeAlarmModule = {
  scheduleAlarm(
    alarmId: string,
    fireAtMillis: number,
    label: string,
    timeOfDay: string,
    targetCount: number,
    exerciseType: ExerciseType,
  ): Promise<void>;
  cancelAlarm(alarmId: string): Promise<void>;
  consumePendingAlarmLaunch?(): Promise<unknown>;
};

export function createNativeLocalAlarmScheduler(
  nativeModule: NativeAlarmModule,
): LocalAlarmScheduler {
  return {
    async schedule(request: LocalAlarmScheduleRequest): Promise<void> {
      await nativeModule.scheduleAlarm(
        request.alarmId,
        new Date(request.fireAt).getTime(),
        request.label ?? '',
        request.timeOfDay ?? '',
        normalizeTargetCount(request.targetCount),
        request.exerciseType ?? DEFAULT_EXERCISE_TYPE,
      );
    },

    async cancel(alarmId: string): Promise<void> {
      await nativeModule.cancelAlarm(alarmId);
    },
  };
}

export function createMirroredLocalAlarmScheduler(
  primary: LocalAlarmScheduler,
  fallback: LocalAlarmScheduler,
): LocalAlarmScheduler {
  return {
    async schedule(request: LocalAlarmScheduleRequest): Promise<void> {
      await primary.schedule(request);
      await fallback.schedule(request);
    },

    async cancel(alarmId: string): Promise<void> {
      await primary.cancel(alarmId);
      await fallback.cancel(alarmId);
    },
  };
}

export async function consumePendingAlarmLaunch(
  nativeModule: Pick<NativeAlarmModule, 'consumePendingAlarmLaunch'>,
): Promise<NativeAlarmLaunch | null> {
  const raw = await nativeModule.consumePendingAlarmLaunch?.();
  if (!isRecord(raw)) {
    return null;
  }

  const alarmId = typeof raw.alarmId === 'string' ? raw.alarmId : '';
  const firedAt = typeof raw.firedAt === 'string' ? raw.firedAt : '';
  if (!alarmId || !firedAt) {
    return null;
  }

  return {
    alarmId,
    firedAt,
    label: typeof raw.label === 'string' ? raw.label : '',
    timeOfDay: typeof raw.timeOfDay === 'string' ? raw.timeOfDay : '',
    targetCount: normalizeTargetCount(typeof raw.targetCount === 'number' ? raw.targetCount : undefined),
    exerciseType: raw.exerciseType === 'push_up' ? 'push_up' : DEFAULT_EXERCISE_TYPE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
