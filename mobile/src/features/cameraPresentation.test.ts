import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldRenderInlineCamera, shouldUseCameraFirstChallengeLayout } from './cameraPresentation.ts';

describe('camera presentation', () => {
  it('does not mount the inline camera while the full-screen alarm challenge is visible', () => {
    assert.equal(shouldRenderInlineCamera({ realCameraEnabled: true, alarmModalVisible: true }), false);
  });

  it('mounts the inline camera only when the camera is enabled and no alarm modal is covering it', () => {
    assert.equal(shouldRenderInlineCamera({ realCameraEnabled: true, alarmModalVisible: false }), true);
    assert.equal(shouldRenderInlineCamera({ realCameraEnabled: false, alarmModalVisible: false }), false);
  });

  it('uses a camera-first challenge layout only for real camera sessions', () => {
    assert.equal(shouldUseCameraFirstChallengeLayout({ realCameraEnabled: true }), true);
    assert.equal(shouldUseCameraFirstChallengeLayout({ realCameraEnabled: false }), false);
  });
});
