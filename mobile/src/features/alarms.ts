// Re-export from domain layer
export { createAlarmConfig, updateAlarmConfig, normalizeTargetCount, DEFAULT_EXERCISE_TYPE } from '../domain/alarm/alarm.ts';
export type { LocalAlarmConfig, CreateAlarmConfigInput, UpdateAlarmConfigInput, ExerciseType } from '../domain/index.ts';
