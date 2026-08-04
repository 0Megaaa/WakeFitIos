import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const config = JSON.parse(
  readFileSync(new URL('../../modules/wakefit-pose-detector/expo-module.config.json', import.meta.url), 'utf8'),
) as {
  platforms?: string[];
  ios?: {
    modules?: string[];
    podspecPath?: string;
  };
};

describe('wakefit native module config', () => {
  it('declares the iOS native module for Expo autolinking', () => {
    assert.equal(config.platforms?.includes('ios'), true);
    assert.equal(config.ios?.modules?.includes('WakeFitPoseDetectorModule'), true);
  });

  it('declares an iOS podspec so CocoaPods can link the local Swift sources', () => {
    assert.equal(config.ios?.podspecPath, 'ios/WakeFitPoseDetector.podspec');
    assert.equal(
      existsSync(new URL('../../modules/wakefit-pose-detector/ios/WakeFitPoseDetector.podspec', import.meta.url)),
      true,
    );
  });
});
