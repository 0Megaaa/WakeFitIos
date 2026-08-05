import type { PendingAlarmLaunchService, PendingAlarmLaunch } from '../ports/PendingAlarmLaunchService.ts';

export type ConsumePendingAlarmLaunchOptions = {
  service: PendingAlarmLaunchService;
};

export async function consumePendingAlarmLaunch(
  options: ConsumePendingAlarmLaunchOptions,
): Promise<PendingAlarmLaunch | null> {
  return options.service.consumePendingLaunch();
}
