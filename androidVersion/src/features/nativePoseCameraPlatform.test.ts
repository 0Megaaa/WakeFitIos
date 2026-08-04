import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { supportsNativePoseCameraPlatform } from './nativePoseCameraPlatform.ts';

describe('native pose camera platform support', () => {
  it('uses the native pose camera on Android and iOS development builds', () => {
    assert.equal(supportsNativePoseCameraPlatform('android'), true);
    assert.equal(supportsNativePoseCameraPlatform('ios'), true);
  });

  it('keeps web and unknown platforms on the fallback camera UI', () => {
    assert.equal(supportsNativePoseCameraPlatform('web'), false);
    assert.equal(supportsNativePoseCameraPlatform('windows'), false);
  });
});
