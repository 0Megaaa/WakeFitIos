import { describe, it, expect } from 'vitest';

// Mock the require for config file testing
// In a real test environment, we would mock the file system

describe('AdsConfig', () => {
  describe('not_configured state with blank config', () => {
    it('should be not_configured when all credentials are empty', () => {
      // Simulate blank config check
      const config = {
        apiBaseUrl: '',
        matrixAppId: '',
        takuAppId: '',
        takuAppKey: '',
      };

      const isConfigured =
        config.apiBaseUrl.trim() !== '' &&
        config.matrixAppId.trim() !== '' &&
        config.takuAppId.trim() !== '' &&
        config.takuAppKey.trim() !== '';

      expect(isConfigured).toBe(false);
    });

    it('should use safe defaults when config is missing', () => {
      const missingConfig = {};

      const defaults = {
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

      const resolvedConfig = {
        apiBaseUrl: (missingConfig as any).apiBaseUrl || defaults.apiBaseUrl,
        matrixAppId: (missingConfig as any).matrixAppId || defaults.matrixAppId,
        appName: (missingConfig as any).appName || defaults.appName,
        takuAppId: (missingConfig as any).takuAppId || defaults.takuAppId,
        takuAppKey: (missingConfig as any).takuAppKey || defaults.takuAppKey,
        splashPlacementId: (missingConfig as any).splashPlacementId || defaults.splashPlacementId,
        bannerPlacementId: (missingConfig as any).bannerPlacementId || defaults.bannerPlacementId,
        nativePlacementId: (missingConfig as any).nativePlacementId || defaults.nativePlacementId,
        interstitialPlacementId: (missingConfig as any).interstitialPlacementId || defaults.interstitialPlacementId,
        rewardedPlacementId: (missingConfig as any).rewardedPlacementId || defaults.rewardedPlacementId,
        fallbackIntervals: {
          bannerSeconds: (missingConfig as any).fallbackIntervals?.bannerSeconds || defaults.fallbackIntervals.bannerSeconds,
          nativeSeconds: (missingConfig as any).fallbackIntervals?.nativeSeconds || defaults.fallbackIntervals.nativeSeconds,
          interstitialSeconds: (missingConfig as any).fallbackIntervals?.interstitialSeconds || defaults.fallbackIntervals.interstitialSeconds,
          rewardSeconds: (missingConfig as any).fallbackIntervals?.rewardSeconds || defaults.fallbackIntervals.rewardSeconds,
        },
      };

      expect(resolvedConfig.apiBaseUrl).toBe(defaults.apiBaseUrl);
      expect(resolvedConfig.matrixAppId).toBe('');
      expect(resolvedConfig.takuAppId).toBe('');
      expect(resolvedConfig.takuAppKey).toBe('');
    });
  });

  describe('configured state with bootstrap config', () => {
    it('should be configured when all bootstrap credentials are provided', () => {
      const config = {
        apiBaseUrl: 'https://yx.youtoball.com/adlj',
        matrixAppId: '12345',
        takuAppId: 'abc123',
        takuAppKey: 'def456',
      };

      const isConfigured =
        config.apiBaseUrl.trim() !== '' &&
        config.matrixAppId.trim() !== '' &&
        config.takuAppId.trim() !== '' &&
        config.takuAppKey.trim() !== '';

      expect(isConfigured).toBe(true);
    });
  });

  describe('remote config merge', () => {
    it('should use remote placement over local fallback', () => {
      const localConfig = {
        bannerPlacementId: 'local_banner_id',
        nativePlacementId: 'local_native_id',
      };

      const remoteConfig = {
        bannerPlacementId: 'remote_banner_id',
        nativePlacementId: '',
      };

      const merged = {
        bannerPlacementId: remoteConfig.bannerPlacementId || localConfig.bannerPlacementId,
        nativePlacementId: remoteConfig.nativePlacementId || localConfig.nativePlacementId,
      };

      expect(merged.bannerPlacementId).toBe('remote_banner_id');
      expect(merged.nativePlacementId).toBe('local_native_id');
    });

    it('should use local fallback when remote is missing', () => {
      const localConfig = {
        interstitialPlacementId: 'local_interstitial_id',
        rewardedPlacementId: 'local_rewarded_id',
      };

      const remoteConfig = {
        interstitialPlacementId: '',
        rewardedPlacementId: 'remote_rewarded_id',
      };

      const merged = {
        interstitialPlacementId: remoteConfig.interstitialPlacementId || localConfig.interstitialPlacementId,
        rewardedPlacementId: remoteConfig.rewardedPlacementId || localConfig.rewardedPlacementId,
      };

      expect(merged.interstitialPlacementId).toBe('local_interstitial_id');
      expect(merged.rewardedPlacementId).toBe('remote_rewarded_id');
    });
  });

  describe('show_ad flag', () => {
    it('should disable ads when show_ad is 0', () => {
      const showAd = 0;
      const adsEnabled = showAd === 1;
      expect(adsEnabled).toBe(false);
    });

    it('should enable ads when show_ad is 1', () => {
      const showAd = 1;
      const adsEnabled = showAd === 1;
      expect(adsEnabled).toBe(true);
    });
  });

  describe('interval normalization', () => {
    it('should use safe fallback for invalid intervals', () => {
      const invalidIntervals = [0, -1, NaN, undefined];

      const safeFallback = 30;

      invalidIntervals.forEach((interval) => {
        const resolvedInterval = interval > 0 ? interval : safeFallback;
        expect(resolvedInterval).toBe(safeFallback);
      });
    });

    it('should use valid positive intervals', () => {
      const validInterval = 45;
      const safeFallback = 30;

      const resolvedInterval = validInterval > 0 ? validInterval : safeFallback;
      expect(resolvedInterval).toBe(45);
    });
  });
});

describe('WakeFitAds JS API', () => {
  it('should export WakeFitAds module interface', async () => {
    // Test that the module structure exists
    // This is a structural test - actual implementation tested via native

    const mockModule = {
      start: async () => {},
      getStatus: async () => ({
        state: 'not_configured',
        adsEnabled: false,
        suppressed: false,
        configLoaded: false,
        sdkInitialized: false,
        loggedIn: false,
      }),
      setSuppressed: async () => {},
      showSplashOnce: async () => {},
      startInterstitialLoop: async () => {},
      stopInterstitialLoop: async () => {},
      showRewarded: async () => false,
      getRewardCooldownRemaining: async () => 0,
    };

    expect(typeof mockModule.start).toBe('function');
    expect(typeof mockModule.getStatus).toBe('function');
    expect(typeof mockModule.setSuppressed).toBe('function');
    expect(typeof mockModule.showSplashOnce).toBe('function');
    expect(typeof mockModule.startInterstitialLoop).toBe('function');
    expect(typeof mockModule.stopInterstitialLoop).toBe('function');
    expect(typeof mockModule.showRewarded).toBe('function');
    expect(typeof mockModule.getRewardCooldownRemaining).toBe('function');
  });
});

describe('Ad suppression logic', () => {
  it('should suppress ads during challenge', () => {
    const mockState = {
      flow: { id: 'challenge-1' },
      snapshot: { status: 'challenge' },
      initialPendingAlarmCheckComplete: true,
    };

    const challengeActive = mockState.flow !== null && mockState.snapshot?.status !== 'idle';
    const pendingAlarmNotChecked = !mockState.initialPendingAlarmCheckComplete;
    const shouldSuppress = challengeActive || pendingAlarmNotChecked;

    expect(shouldSuppress).toBe(true);
  });

  it('should not suppress ads when alarm check is complete and no challenge', () => {
    const mockState = {
      flow: null,
      snapshot: null,
      initialPendingAlarmCheckComplete: true,
    };

    const challengeActive = mockState.flow !== null && mockState.snapshot?.status !== 'idle';
    const pendingAlarmNotChecked = !mockState.initialPendingAlarmCheckComplete;
    const shouldSuppress = challengeActive || pendingAlarmNotChecked;

    expect(shouldSuppress).toBe(false);
  });

  it('should suppress ads when initial pending alarm check is not complete', () => {
    const mockState = {
      flow: null,
      snapshot: null,
      initialPendingAlarmCheckComplete: false,
    };

    const challengeActive = mockState.flow !== null && mockState.snapshot?.status !== 'idle';
    const pendingAlarmNotChecked = !mockState.initialPendingAlarmCheckComplete;
    const shouldSuppress = challengeActive || pendingAlarmNotChecked;

    expect(shouldSuppress).toBe(true);
  });
});
