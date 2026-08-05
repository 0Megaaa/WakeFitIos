import { createAlarmAlertController, type AlarmAlertController } from '../../application/ports/AlarmAlertService.ts';
import { getExpoNativeModule, getOS, getVibration, getReactNativeModules } from '../runtime/reactNativePlatformRuntime.ts';

type WakeFitPoseDetectorModule = {
  startAlarmTone?: () => Promise<void>;
  stopAlarmTone?: () => Promise<void>;
};

let cachedWakeFitModule: WakeFitPoseDetectorModule | null | undefined;

function getWakeFitModule(): WakeFitPoseDetectorModule | null {
  if (cachedWakeFitModule !== undefined) {
    return cachedWakeFitModule;
  }

  try {
    cachedWakeFitModule = getExpoNativeModule<WakeFitPoseDetectorModule>('WakeFitPoseDetector');
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}

function getSoundManager(): { playTouchSound?: () => void } | null {
  const modules = getReactNativeModules();
  if (!modules) return null;
  return (modules as { SoundManager?: { playTouchSound?: () => void } | null }).SoundManager ?? null;
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
      soundManager?.playTouchSound?.();
    },
  });
}
