import { type ExpoConfig } from 'expo';

import appJson from './app.json';

export interface AdsLocalConfig {
  apiBaseUrl: string;
  matrixAppId: string;
  appName: string;
  takuAppId: string;
  takuAppKey: string;
  splashPlacementId: string;
  bannerPlacementId: string;
  nativePlacementId: string;
  interstitialPlacementId: string;
  rewardedPlacementId: string;
  fallbackIntervals: {
    bannerSeconds: number;
    nativeSeconds: number;
    interstitialSeconds: number;
    rewardSeconds: number;
  };
}

const DEFAULT_ADS_CONFIG: AdsLocalConfig = {
  apiBaseUrl: 'https://yx.youtoball.com/adlj',
  matrixAppId: '',
  appName: 'WakeFit',
  takuAppId: '',
  takuAppKey: '',
  splashPlacementId: '',
  bannerPlacementId: '',
  nativePlacementId: '',
  interstitialPlacementId: '',
  rewardedPlacementId: '',
  fallbackIntervals: {
    bannerSeconds: 30,
    nativeSeconds: 30,
    interstitialSeconds: 60,
    rewardSeconds: 60,
  },
};

function loadAdsLocalConfig(): AdsLocalConfig {
  try {
    // Dynamic require for local config file
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const localConfig = require('./config/ads.local.json') as AdsLocalConfig;
    return {
      apiBaseUrl: localConfig.apiBaseUrl || DEFAULT_ADS_CONFIG.apiBaseUrl,
      matrixAppId: localConfig.matrixAppId || '',
      appName: localConfig.appName || DEFAULT_ADS_CONFIG.appName,
      takuAppId: localConfig.takuAppId || '',
      takuAppKey: localConfig.takuAppKey || '',
      splashPlacementId: localConfig.splashPlacementId || '',
      bannerPlacementId: localConfig.bannerPlacementId || '',
      nativePlacementId: localConfig.nativePlacementId || '',
      interstitialPlacementId: localConfig.interstitialPlacementId || '',
      rewardedPlacementId: localConfig.rewardedPlacementId || '',
      fallbackIntervals: {
        bannerSeconds: localConfig.fallbackIntervals?.bannerSeconds || DEFAULT_ADS_CONFIG.fallbackIntervals.bannerSeconds,
        nativeSeconds: localConfig.fallbackIntervals?.nativeSeconds || DEFAULT_ADS_CONFIG.fallbackIntervals.nativeSeconds,
        interstitialSeconds: localConfig.fallbackIntervals?.interstitialSeconds || DEFAULT_ADS_CONFIG.fallbackIntervals.interstitialSeconds,
        rewardSeconds: localConfig.fallbackIntervals?.rewardSeconds || DEFAULT_ADS_CONFIG.fallbackIntervals.rewardSeconds,
      },
    };
  } catch {
    // Config file not found or invalid, use defaults
    return DEFAULT_ADS_CONFIG;
  }
}

function buildInfoPlistKeys(adsConfig: AdsLocalConfig): Record<string, string | number> {
  return {
    WakeFitAdsAPIBaseURL: adsConfig.apiBaseUrl,
    WakeFitAdsMatrixAppID: adsConfig.matrixAppId,
    WakeFitAdsAppName: adsConfig.appName,
    WakeFitTakuAppID: adsConfig.takuAppId,
    WakeFitTakuAppKey: adsConfig.takuAppKey,
    WakeFitSplashPlacementID: adsConfig.splashPlacementId,
    WakeFitBannerPlacementID: adsConfig.bannerPlacementId,
    WakeFitNativePlacementID: adsConfig.nativePlacementId,
    WakeFitInterstitialPlacementID: adsConfig.interstitialPlacementId,
    WakeFitRewardedPlacementID: adsConfig.rewardedPlacementId,
    WakeFitBannerFallbackInterval: adsConfig.fallbackIntervals.bannerSeconds,
    WakeFitNativeFallbackInterval: adsConfig.fallbackIntervals.nativeSeconds,
    WakeFitInterstitialFallbackInterval: adsConfig.fallbackIntervals.interstitialSeconds,
    WakeFitRewardFallbackInterval: adsConfig.fallbackIntervals.rewardSeconds,
  };
}

function mergeConfigs(expoConfig: ExpoConfig): ExpoConfig {
  const adsConfig = loadAdsLocalConfig();
  const infoPlistKeys = buildInfoPlistKeys(adsConfig);

  // Merge with existing iOS config
  const existingIos = expoConfig.ios || {};
  const existingInfoPlist = existingIos.infoPlist || {};

  return {
    ...expoConfig,
    ios: {
      ...existingIos,
      infoPlist: {
        ...existingInfoPlist,
        ...infoPlistKeys,
      },
    },
  };
}

const config: ExpoConfig = mergeConfigs(appJson);

export default config;
