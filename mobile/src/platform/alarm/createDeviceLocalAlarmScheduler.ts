import { createRequire } from 'node:module';

import { createMirroredLocalAlarmScheduler, createNativeLocalAlarmScheduler, consumePendingAlarmLaunch, type NativeAlarmLaunch, type NativeAlarmModule } from './nativeAlarmBridge.ts';
import { ForegroundLocalAlarmScheduler, type LocalAlarmScheduleRequest, type LocalAlarmScheduler } from './ForegroundLocalAlarmScheduler.ts';

let cachedWakeFitModule: NativeAlarmModule | null | undefined;
let localRequire: ((id: string) => unknown) | undefined;

function getRequire(): ((id: string) => unknown) {
  if (!localRequire) {
    localRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  }
  return localRequire;
}

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
    const { requireNativeModule } = getRequire()('expo-modules-core') as { requireNativeModule: (name: string) => unknown };
    cachedWakeFitModule = requireNativeModule('WakeFitPoseDetector') as NativeAlarmModule;
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}

export { ForegroundLocalAlarmScheduler, type LocalAlarmScheduleRequest, type LocalAlarmScheduler };