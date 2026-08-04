import type { ExerciseType } from '../../features/alarms.ts';

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
