import type { AlarmScheduler } from '../ports/AlarmScheduler.js';

export type ScheduleAlarmOptions = {
  scheduler: AlarmScheduler;
  alarmId: string;
  fireAt: string;
  label?: string;
  timeOfDay?: string;
  targetCount?: number;
  exerciseType?: 'push_up' | 'squat';
};

export async function scheduleAlarm(options: ScheduleAlarmOptions): Promise<void> {
  const { scheduler, alarmId, fireAt, label, timeOfDay, targetCount, exerciseType } = options;

  await scheduler.schedule({
    alarmId,
    fireAt,
    label,
    timeOfDay,
    targetCount,
    exerciseType,
  });
}
