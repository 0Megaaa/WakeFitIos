import { createRequire } from 'node:module';

import { supportsNativePoseCameraPlatform } from './camera/nativePoseCameraPlatform.ts';
import { createPermissionService } from './permissions/createPermissionService.ts';
import { createForegroundAlarmEvents } from './alarm/createForegroundAlarmEvents.ts';
import { createDeviceLocalAlarmScheduler } from './alarm/createDeviceLocalAlarmScheduler.ts';
import { createDeviceAlarmAlert } from './alarm/createDeviceAlarmAlert.ts';
import { consumeDevicePendingAlarmLaunch } from './alarm/createDeviceLocalAlarmScheduler.ts';
import { ForegroundLocalAlarmScheduler } from './alarm/ForegroundLocalAlarmScheduler.ts';
import type { PendingAlarmLaunchService } from '../application/ports/PendingAlarmLaunchService.ts';
import type { PlatformServices } from './types.ts';

const localRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

export type CreatePlatformServicesOptions = {
  platformOS?: string;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => NodeJS.Timeout | number;
  clearTimer?: (handle: NodeJS.Timeout | number) => void;
};

export function createPlatformServices(options: CreatePlatformServicesOptions = {}): PlatformServices {
  let platformOS = options.platformOS;
  if (platformOS === undefined) {
    // Defer the react-native import to runtime so this module can be loaded
    // by Node.js test runners without bundlers.
    try {
      const { Platform } = localRequire('react-native');
      platformOS = Platform.OS;
    } catch {
      platformOS = 'unknown';
    }
  }

  const foregroundAlarmEvents = createForegroundAlarmEvents();
  const foregroundScheduler = new ForegroundLocalAlarmScheduler({
    now: options.now,
    setTimer: options.setTimer as never,
    clearTimer: options.clearTimer as never,
    onFire: (request) => {
      foregroundAlarmEvents.emit({
        alarmId: request.alarmId,
        firedAt: request.fireAt,
        label: request.label,
        timeOfDay: request.timeOfDay,
        targetCount: request.targetCount,
        exerciseType: request.exerciseType,
      });
    },
  });

  const alarmScheduler = createDeviceLocalAlarmScheduler(foregroundScheduler);
  const alarmAlertService = createDeviceAlarmAlert();
  const pendingAlarmLaunchService: PendingAlarmLaunchService = {
    async consumePendingLaunch() {
      const launch = await consumeDevicePendingAlarmLaunch();
      if (!launch) {
        return null;
      }
      return {
        alarmId: launch.alarmId,
        firedAt: launch.firedAt,
        label: launch.label,
        timeOfDay: launch.timeOfDay,
        targetCount: launch.targetCount,
        exerciseType: launch.exerciseType,
      };
    },
  };

  return {
    alarmScheduler,
    alarmAlertService,
    pendingAlarmLaunchService,
    foregroundAlarmEvents,
    permissionService: createPermissionService(),
    poseCamera: {
      supported: supportsNativePoseCameraPlatform(platformOS ?? 'unknown'),
    },
  };
}