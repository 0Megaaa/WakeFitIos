import type { ExerciseType } from '../../domain/alarm/alarm.ts';

export type AlarmScheduleRequest = {
  alarmId: string;
  fireAt: string;
  label?: string;
  timeOfDay?: string;
  targetCount?: number;
  exerciseType?: ExerciseType;
};

export interface AlarmScheduler {
  schedule(request: AlarmScheduleRequest): Promise<void>;
  cancel(alarmId: string): Promise<void>;
}
