import { NativeModules, Platform, Vibration } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

import { createAlarmAlertController, type AlarmAlertController } from './alarmAlert.ts';

type WakeFitPoseDetectorModule = {
  startAlarmTone?: () => Promise<void>;
  stopAlarmTone?: () => Promise<void>;
};

let cachedWakeFitModule: WakeFitPoseDetectorModule | null | undefined;

export function createDeviceAlarmAlert(): AlarmAlertController {
  return createAlarmAlertController({
    startNativeTone: async () => {
      await getWakeFitModule()?.startAlarmTone?.();
    },
    stopNativeTone: async () => {
      await getWakeFitModule()?.stopAlarmTone?.();
    },
    startVibration: () => {
      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 900, 350, 900], true);
      }
    },
    stopVibration: () => {
      if (Platform.OS !== 'web') {
        Vibration.cancel();
      }
    },
    playFallbackSound: () => {
      NativeModules.SoundManager?.playTouchSound?.();
    },
  });
}

function getWakeFitModule(): WakeFitPoseDetectorModule | null {
  if (cachedWakeFitModule !== undefined) {
    return cachedWakeFitModule;
  }

  try {
    cachedWakeFitModule = requireNativeModule('WakeFitPoseDetector') as WakeFitPoseDetectorModule;
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}
