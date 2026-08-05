import { createAlarmAlertController, type AlarmAlertController } from '../../application/ports/AlarmAlertService.ts';
import { getNativeModule, getOS, getVibration } from '../runtime/reactNativePlatformRuntime.ts';

type WakeFitPoseDetectorModule = {
  startAlarmTone?: () => Promise<void>;
  stopAlarmTone?: () => Promise<void>;
};

type RNSoundNativeModules = {
  SoundManager?: {
    playTouchSound?: () => void;
  };
};

let cachedWakeFitModule: WakeFitPoseDetectorModule | null | undefined;

function getWakeFitModule(): WakeFitPoseDetectorModule | null {
  if (cachedWakeFitModule !== undefined) {
    return cachedWakeFitModule;
  }

  try {
    cachedWakeFitModule = getNativeModule<WakeFitPoseDetectorModule>('WakeFitPoseDetector');
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}

function getSoundManager(): RNSoundNativeModules | null {
  try {
    return getNativeModule<RNSoundNativeModules>('react-native');
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
      const platform = getOS();
      if (platform === 'web') return;
      const vibration = getVibration();
      if (!vibration) return;
      vibration.vibrate([0, 900, 350, 900], true);
    },
    stopVibration: () => {
      const platform = getOS();
      if (platform === 'web') return;
      const vibration = getVibration();
      if (!vibration) return;
      vibration.cancel();
    },
    playFallbackSound: () => {
      const soundManager = getSoundManager();
      soundManager?.SoundManager?.playTouchSound?.();
    },
  });
}
