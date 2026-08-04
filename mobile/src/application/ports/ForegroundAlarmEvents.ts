import type { ExerciseType } from '../../domain/exercise/types.js';

export type ForegroundAlarmEvent = {
  alarmId: string;
  firedAt: string;
  label?: string;
  timeOfDay?: string;
  targetCount?: number;
  exerciseType?: ExerciseType;
};

export type ForegroundAlarmEvents = {
  subscribe(listener: (event: ForegroundAlarmEvent) => void): () => void;
  emit(event: ForegroundAlarmEvent): void;
};
