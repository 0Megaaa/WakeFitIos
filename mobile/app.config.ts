import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

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
  matrixAppId: '38',
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

function loadAdsLocalConfig(projectRoot: string): AdsLocalConfig {
  const configPath = join(projectRoot, 'config', 'ads.local.json');
  if (!existsSync(configPath)) {
    return DEFAULT_ADS_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const localConfig: AdsLocalConfig = JSON.parse(raw);
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
        bannerSeconds:
          localConfig.fallbackIntervals?.bannerSeconds ??
          DEFAULT_ADS_CONFIG.fallbackIntervals.bannerSeconds,
        nativeSeconds:
          localConfig.fallbackIntervals?.nativeSeconds ??
          DEFAULT_ADS_CONFIG.fallbackIntervals.nativeSeconds,
        interstitialSeconds:
          localConfig.fallbackIntervals?.interstitialSeconds ??
          DEFAULT_ADS_CONFIG.fallbackIntervals.interstitialSeconds,
        rewardSeconds:
          localConfig.fallbackIntervals?.rewardSeconds ??
          DEFAULT_ADS_CONFIG.fallbackIntervals.rewardSeconds,
      },
    };
  } catch {
    // Config file invalid or unreadable, use defaults
    return DEFAULT_ADS_CONFIG;
  }
}

function buildInfoPlistKeys(
  adsConfig: AdsLocalConfig
): Record<string, string | number> {
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
    WakeFitInterstitialFallbackInterval:
      adsConfig.fallbackIntervals.interstitialSeconds,
    WakeFitRewardFallbackInterval:
      adsConfig.fallbackIntervals.rewardSeconds,
  };
}

export default (
  { config, projectRoot }: ConfigContext
): ExpoConfig => {
  const adsConfig = loadAdsLocalConfig(projectRoot ?? process.cwd());
  const infoPlistKeys = buildInfoPlistKeys(adsConfig);

  // Merge ad keys into existing normalized ExpoConfig
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        ...infoPlistKeys,
      },
    },
  };
};
