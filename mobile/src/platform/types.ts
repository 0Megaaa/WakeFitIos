import type { AlarmScheduler } from '../application/ports/AlarmScheduler.ts';
import type { AlarmAlertService } from '../application/ports/AlarmAlertService.ts';
import type { ForegroundAlarmEvents } from '../application/ports/ForegroundAlarmEvents.ts';
import type { PendingAlarmLaunchService } from '../application/ports/PendingAlarmLaunchService.ts';
import type { PermissionService } from '../application/ports/PermissionService.ts';

export type PlatformServices = {
  alarmScheduler: AlarmScheduler;
  alarmAlertService: AlarmAlertService;
  pendingAlarmLaunchService: PendingAlarmLaunchService;
  foregroundAlarmEvents: ForegroundAlarmEvents;
  permissionService: PermissionService;
  poseCamera: {
    supported: boolean;
  };
};