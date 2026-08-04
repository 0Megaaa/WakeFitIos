import { requireNativeModule } from 'expo-modules-core';

import { createMirroredLocalAlarmScheduler, createNativeLocalAlarmScheduler, consumePendingAlarmLaunch, type NativeAlarmLaunch, type NativeAlarmModule } from './nativeAlarmBridge.ts';
import { ForegroundLocalAlarmScheduler, type LocalAlarmScheduleRequest, type LocalAlarmScheduler } from './ForegroundLocalAlarmScheduler.ts';

let cachedWakeFitModule: NativeAlarmModule | null | undefined;

export function createDeviceLocalAlarmScheduler(fallback: LocalAlarmScheduler): LocalAlarmScheduler {
  const nativeModule = getWakeFitModule();
  return nativeModule ? createMirroredLocalAlarmScheduler(createNativeLocalAlarmScheduler(nativeModule), fallback) : fallback;
}

export async function consumeDevicePendingAlarmLaunch(): Promise<NativeAlarmLaunch | null> {
  const nativeModule = getWakeFitModule();
  return nativeModule ? consumePendingAlarmLaunch(nativeModule) : null;
}

function getWakeFitModule(): NativeAlarmModule | null {
  if (cachedWakeFitModule !== undefined) {
    return cachedWakeFitModule;
  }

  try {
    cachedWakeFitModule = requireNativeModule('WakeFitPoseDetector') as NativeAlarmModule;
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}

export { ForegroundLocalAlarmScheduler, type LocalAlarmScheduleRequest, type LocalAlarmScheduler };
