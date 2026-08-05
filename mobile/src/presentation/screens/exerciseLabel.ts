import type { ExerciseType } from '../../domain/alarm/alarm.ts';

export function getExerciseLabel(exerciseType: ExerciseType): string {
  return exerciseType === 'squat' ? '深蹲' : '俯卧撑';
}