export { type LocalAlarmConfig, type CreateAlarmConfigInput, type UpdateAlarmConfigInput } from './types.ts';
export { type ExerciseType } from '../exercise/types.ts';

export {
  createAlarmConfig,
  updateAlarmConfig,
  normalizeTargetCount,
  DEFAULT_EXERCISE_TYPE,
} from './alarm.ts';
