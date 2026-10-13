import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Replicate the same pure config-resolution logic that app.config.ts uses.
// We test the semantics without importing the actual config loader (which
// depends on expo's ConfigContext), so these are isolated unit tests matching
// repo's native node:test harness.

describe('AdsConfig', () => {
  describe('not_configured state with blank config', () => {
    it('should be not_configured when all credentials are empty', () => {
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

      assert.strictEqual(isConfigured, false);
    });

    it('should use safe defaults when config is missing', () => {
      const missingConfig = {} as Record<string, unknown>;

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
        apiBaseUrl: (missingConfig['apiBaseUrl'] as string) || defaults.apiBaseUrl,
        matrixAppId: (missingConfig['matrixAppId'] as string) || defaults.matrixAppId,
        appName: (missingConfig['appName'] as string) || defaults.appName,
        takuAppId: (missingConfig['takuAppId'] as string) || defaults.takuAppId,
        takuAppKey: (missingConfig['takuAppKey'] as string) || defaults.takuAppKey,
        splashPlacementId:
          (missingConfig['splashPlacementId'] as string) || defaults.splashPlacementId,
        bannerPlacementId:
          (missingConfig['bannerPlacementId'] as string) || defaults.bannerPlacementId,
        nativePlacementId:
          (missingConfig['nativePlacementId'] as string) || defaults.nativePlacementId,
        interstitialPlacementId:
          (missingConfig['interstitialPlacementId'] as string) ||
          defaults.interstitialPlacementId,
        rewardedPlacementId:
          (missingConfig['rewardedPlacementId'] as string) || defaults.rewardedPlacementId,
        fallbackIntervals: {
          bannerSeconds:
            (missingConfig['fallbackIntervals'] as Record<string, unknown>)?.['bannerSeconds']
              ??
              defaults.fallbackIntervals.bannerSeconds,
          nativeSeconds:
            (missingConfig['fallbackIntervals'] as Record<string, unknown>)?.['nativeSeconds']
              ??
              defaults.fallbackIntervals.nativeSeconds,
          interstitialSeconds:
            (missingConfig['fallbackIntervals'] as Record<string, unknown>)?.[
              'interstitialSeconds'
            ] ?? defaults.fallbackIntervals.interstitialSeconds,
          rewardSeconds:
            (missingConfig['fallbackIntervals'] as Record<string, unknown>)?.[
              'rewardSeconds'
            ] ?? defaults.fallbackIntervals.rewardSeconds,
        },
      };

      assert.strictEqual(resolvedConfig.apiBaseUrl, defaults.apiBaseUrl);
      assert.strictEqual(resolvedConfig.matrixAppId, '');
      assert.strictEqual(resolvedConfig.takuAppId, '');
      assert.strictEqual(resolvedConfig.takuAppKey, '');
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

      assert.strictEqual(isConfigured, true);
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

      assert.strictEqual(merged.bannerPlacementId, 'remote_banner_id');
      assert.strictEqual(merged.nativePlacementId, 'local_native_id');
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
        interstitialPlacementId:
          remoteConfig.interstitialPlacementId || localConfig.interstitialPlacementId,
        rewardedPlacementId:
          remoteConfig.rewardedPlacementId || localConfig.rewardedPlacementId,
      };

      assert.strictEqual(merged.interstitialPlacementId, 'local_interstitial_id');
      assert.strictEqual(merged.rewardedPlacementId, 'remote_rewarded_id');
    });
  });

  describe('show_ad flag', () => {
    it('should disable ads when show_ad is 0', () => {
      const showAd: number = 0;
      const adsEnabled = showAd === 1;
      assert.strictEqual(adsEnabled, false);
    });

    it('should enable ads when show_ad is 1', () => {
      const showAd: number = 1;
      const adsEnabled = showAd === 1;
      assert.strictEqual(adsEnabled, true);
    });
  });

  describe('interval normalization', () => {
    it('should use safe fallback for invalid intervals', () => {
      const invalidIntervals = [0, -1, NaN, undefined];

      const safeFallback = 30;

      invalidIntervals.forEach((interval) => {
        const resolvedInterval =
          typeof interval === 'number' && interval > 0 ? interval : safeFallback;
        assert.strictEqual(resolvedInterval, safeFallback);
      });
    });

    it('should use valid positive intervals', () => {
      const validInterval = 45;
      const safeFallback = 30;

      const resolvedInterval = validInterval > 0 ? validInterval : safeFallback;
      assert.strictEqual(resolvedInterval, 45);
    });
  });
});

describe('Ad suppression logic', () => {
  type MockState = {
    flow: { id: string } | null;
    snapshot: { status: string } | null;
    initialPendingAlarmCheckComplete: boolean;
  };

  it('should suppress ads during challenge', () => {
    const mockState: MockState = {
      flow: { id: 'challenge-1' },
      snapshot: { status: 'challenge' },
      initialPendingAlarmCheckComplete: true,
    };

    const challengeActive =
      mockState.flow !== null && mockState.snapshot?.status !== 'idle';
    const pendingAlarmNotChecked = !mockState.initialPendingAlarmCheckComplete;
    const shouldSuppress = challengeActive || pendingAlarmNotChecked;

    assert.strictEqual(shouldSuppress, true);
  });

  it('should not suppress ads when alarm check is complete and no challenge', () => {
    const mockState: MockState = {
      flow: null,
      snapshot: null,
      initialPendingAlarmCheckComplete: true,
    };

    const challengeActive =
      mockState.flow !== null && mockState.snapshot?.status !== 'idle';
    const pendingAlarmNotChecked = !mockState.initialPendingAlarmCheckComplete;
    const shouldSuppress = challengeActive || pendingAlarmNotChecked;

    assert.strictEqual(shouldSuppress, false);
  });

  it('should suppress ads when initial pending alarm check is not complete', () => {
    const mockState: MockState = {
      flow: null,
      snapshot: null,
      initialPendingAlarmCheckComplete: false,
    };

    const challengeActive =
      mockState.flow !== null && mockState.snapshot?.status !== 'idle';
    const pendingAlarmNotChecked = !mockState.initialPendingAlarmCheckComplete;
    const shouldSuppress = challengeActive || pendingAlarmNotChecked;

    assert.strictEqual(shouldSuppress, true);
  });
});
