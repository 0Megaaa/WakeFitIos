import type { ExerciseType } from '../../domain/alarm/alarm.ts';

export type PendingAlarmLaunch = {
  alarmId: string;
  firedAt: string;
  label?: string;
  timeOfDay?: string;
  targetCount?: number;
  exerciseType?: ExerciseType;
};

export interface PendingAlarmLaunchService {
  consumePendingLaunch(): Promise<PendingAlarmLaunch | null>;
}
