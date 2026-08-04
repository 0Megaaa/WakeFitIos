import type { PendingAlarmLaunchService, PendingAlarmLaunch } from '../ports/PendingAlarmLaunchService.js';

export type ConsumePendingAlarmLaunchOptions = {
  service: PendingAlarmLaunchService;
};

export async function consumePendingAlarmLaunch(
  options: ConsumePendingAlarmLaunchOptions,
): Promise<PendingAlarmLaunch | null> {
  return options.service.consumePendingLaunch();
}
