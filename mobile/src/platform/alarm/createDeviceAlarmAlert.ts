import { createRequire } from 'node:module';

import { createAlarmAlertController, type AlarmAlertController } from '../../application/ports/AlarmAlertService.ts';

type WakeFitPoseDetectorModule = {
  startAlarmTone?: () => Promise<void>;
  stopAlarmTone?: () => Promise<void>;
};

type RNSoundNativeModules = {
  SoundManager?: {
    playTouchSound?: () => void;
  };
};

type RNVibrationNative = {
  vibrate: (pattern: number[], repeat: boolean) => void;
  cancel: () => void;
};

type RNPlatformRef = { OS: string };

let cachedWakeFitModule: WakeFitPoseDetectorModule | null | undefined;
let localRequire: ((id: string) => unknown) | undefined;

function getRequire(): ((id: string) => unknown) {
  if (!localRequire) {
    localRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  }
  return localRequire;
}

function getReactNative(): { NativeModules: RNSoundNativeModules; Platform: RNPlatformRef; Vibration: RNVibrationNative } | null {
  try {
    return getRequire()('react-native') as { NativeModules: RNSoundNativeModules; Platform: RNPlatformRef; Vibration: RNVibrationNative };
  } catch {
    return null;
  }
}

export function createDeviceAlarmAlert(): AlarmAlertController {
  return createAlarmAlertController({
    startNativeTone: async () => {
      await getWakeFitModule()?.startAlarmTone?.();
    },
    stopNativeTone: async () => {
      await getWakeFitModule()?.stopAlarmTone?.();
    },
    startVibration: () => {
      const rn = getReactNative();
      if (rn && rn.Platform.OS !== 'web') {
        rn.Vibration.vibrate([0, 900, 350, 900], true);
      }
    },
    stopVibration: () => {
      const rn = getReactNative();
      if (rn && rn.Platform.OS !== 'web') {
        rn.Vibration.cancel();
      }
    },
    playFallbackSound: () => {
      const rn = getReactNative();
      rn?.NativeModules.SoundManager?.playTouchSound?.();
    },
  });
}

function getWakeFitModule(): WakeFitPoseDetectorModule | null {
  if (cachedWakeFitModule !== undefined) {
    return cachedWakeFitModule;
  }

  try {
    const { requireNativeModule } = getRequire()('expo-modules-core') as { requireNativeModule: (name: string) => unknown };
    cachedWakeFitModule = requireNativeModule('WakeFitPoseDetector') as WakeFitPoseDetectorModule;
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}