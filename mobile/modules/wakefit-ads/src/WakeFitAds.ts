import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { AdsStatus, WakeFitAdsStatus } from './types';

interface WakeFitAdsModuleType {
  start(): Promise<void>;
  getStatus(): Promise<WakeFitAdsStatus>;
  setSuppressed(suppressed: boolean): Promise<void>;
  showSplashOnce(): Promise<void>;
  startInterstitialLoop(sceneID: string): Promise<void>;
  stopInterstitialLoop(): Promise<void>;
  showRewarded(sceneID: string): Promise<boolean>;
  getRewardCooldownRemaining(): Promise<number>;
}

const MODULE_NAME = 'WakeFitAds';

// Platform-safe native module loading via Expo Modules API
function getNativeModule(): WakeFitAdsModuleType | null {
  if (Platform.OS !== 'ios') {
    return null;
  }

  try {
    return requireOptionalNativeModule<WakeFitAdsModuleType>(MODULE_NAME);
  } catch {
    return null;
  }
}

function createNoopModule(): WakeFitAdsModuleType {
  return {
    start: async () => {
      // No-op on non-iOS platforms
    },
    getStatus: async (): Promise<WakeFitAdsStatus> => ({
      state: 'not_configured' as AdsStatus,
      adsEnabled: false,
      suppressed: false,
      configLoaded: false,
      sdkInitialized: false,
      loggedIn: false,
    }),
    setSuppressed: async () => {
      // No-op
    },
    showSplashOnce: async () => {
      // No-op
    },
    startInterstitialLoop: async () => {
      // No-op
    },
    stopInterstitialLoop: async () => {
      // No-op
    },
    showRewarded: async (): Promise<boolean> => false,
    getRewardCooldownRemaining: async (): Promise<number> => 0,
  };
}

const nativeModule = getNativeModule() ?? createNoopModule();

export const WakeFitAds = {
  async start(): Promise<void> {
    return nativeModule.start();
  },

  async getStatus(): Promise<WakeFitAdsStatus> {
    return nativeModule.getStatus();
  },

  async setSuppressed(suppressed: boolean): Promise<void> {
    return nativeModule.setSuppressed(suppressed);
  },

  async showSplashOnce(): Promise<void> {
    return nativeModule.showSplashOnce();
  },

  async startInterstitialLoop(sceneID: string): Promise<void> {
    return nativeModule.startInterstitialLoop(sceneID);
  },

  async stopInterstitialLoop(): Promise<void> {
    return nativeModule.stopInterstitialLoop();
  },

  async showRewarded(sceneID: string): Promise<boolean> {
    return nativeModule.showRewarded(sceneID);
  },

  async getRewardCooldownRemaining(): Promise<number> {
    return nativeModule.getRewardCooldownRemaining();
  },
};
