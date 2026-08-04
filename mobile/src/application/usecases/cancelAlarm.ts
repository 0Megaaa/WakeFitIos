import type { AlarmScheduler } from '../ports/AlarmScheduler.js';

export type CancelAlarmOptions = {
  scheduler: AlarmScheduler;
  alarmId: string;
};

export async function cancelAlarm(options: CancelAlarmOptions): Promise<void> {
  const { scheduler, alarmId } = options;
  await scheduler.cancel(alarmId);
}
