// Re-export from native module
// This file provides a stable import path for the ad module

import { NativeModules, Platform } from 'react-native';

import type { AdsStatus, WakeFitAdsStatus } from '../../modules/wakefit-ads/src/types';

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

const NATIVE_MODULE_NAME = 'WakeFitAds';

function getNativeModule(): WakeFitAdsModuleType | null {
  if (Platform.OS !== 'ios') {
    return null;
  }

  try {
    return NativeModules[NATIVE_MODULE_NAME] as WakeFitAdsModuleType;
  } catch {
    return null;
  }
}

const nativeModule = getNativeModule();

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

export const WakeFitAds = nativeModule ?? createNoopModule();
