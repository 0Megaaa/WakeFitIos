export type ExerciseType = 'push_up' | 'squat';

export type LocalAlarmConfig = {
  id: string;
  serverId?: number;
  label: string;
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  targetCount: number;
  exerciseType: ExerciseType;
  createdAt: string;
  updatedAt: string;
};

export type CreateAlarmConfigInput = {
  id: string;
  serverId?: number;
  label?: string;
  timeOfDay: string;
  timezone?: string;
  enabled?: boolean;
  targetCount?: number;
  exerciseType?: ExerciseType;
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateAlarmConfigInput = {
  serverId?: number;
  label?: string;
  timeOfDay?: string;
  timezone?: string;
  enabled?: boolean;
  targetCount?: number;
  exerciseType?: ExerciseType;
  updatedAt?: string;
};

const DEFAULT_TARGET_COUNT = 5;
const MIN_TARGET_COUNT = 1;
const MAX_TARGET_COUNT = 100;
export const DEFAULT_EXERCISE_TYPE: ExerciseType = 'squat';

export function createAlarmConfig(input: CreateAlarmConfigInput): LocalAlarmConfig {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    id: input.id,
    serverId: input.serverId,
    label: input.label ?? '',
    timeOfDay: input.timeOfDay,
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: input.enabled ?? true,
    targetCount: normalizeTargetCount(input.targetCount),
    exerciseType: input.exerciseType ?? DEFAULT_EXERCISE_TYPE,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export function updateAlarmConfig(
  alarm: LocalAlarmConfig,
  updates: UpdateAlarmConfigInput,
): LocalAlarmConfig {
  return {
    ...alarm,
    ...updates,
    targetCount:
      updates.targetCount === undefined
        ? alarm.targetCount
        : normalizeTargetCount(updates.targetCount),
    timezone: updates.timezone ?? alarm.timezone,
    exerciseType: updates.exerciseType ?? alarm.exerciseType,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };
}

export function normalizeTargetCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TARGET_COUNT;
  }

  return clamp(Math.trunc(value), MIN_TARGET_COUNT, MAX_TARGET_COUNT);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
