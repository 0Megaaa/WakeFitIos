import type { ExerciseType } from '../../features/alarms.ts';

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
