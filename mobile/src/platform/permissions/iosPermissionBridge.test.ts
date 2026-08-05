import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('iOS permission bridge', () => {
  const modulePath = new URL(
    '../../../modules/wakefit-pose-detector/ios/WakeFitPoseDetectorModule.swift',
    import.meta.url,
  );
  const moduleSource = readFileSync(modulePath, 'utf-8');

  it('declares AVFoundation camera permission methods', () => {
    assert.ok(moduleSource.includes('AsyncFunction("getCameraPermissionStatus")'));
    assert.ok(moduleSource.includes('AsyncFunction("requestCameraPermission")'));
  });

  it('declares UserNotifications notification permission methods', () => {
    assert.ok(moduleSource.includes('AsyncFunction("getNotificationPermissionStatus")'));
    assert.ok(moduleSource.includes('AsyncFunction("requestNotificationPermission")'));
  });

  it('imports AVFoundation and UserNotifications', () => {
    assert.ok(moduleSource.includes('import AVFoundation'));
    assert.ok(moduleSource.includes('import UserNotifications'));
  });

  it('maps AVCaptureDevice authorization status to PermissionStatus strings', () => {
    // Verify the mapping function exists with expected branches.
    assert.ok(moduleSource.includes('authorized'));
    assert.ok(moduleSource.includes('denied'));
    assert.ok(moduleSource.includes('restricted'));
    assert.ok(moduleSource.includes('notDetermined'));
  });

  it('maps UNAuthorizationStatus to PermissionStatus strings', () => {
    assert.ok(moduleSource.includes('provisional'));
    assert.ok(moduleSource.includes('ephemeral'));
  });

  it('does not fabricate granted status', () => {
    // requestCameraPermission must branch on actual AVAuthorizationStatus and call requestAccess
    assert.ok(moduleSource.includes('AVCaptureDevice.requestAccess'));
    // Should not blindly return "granted" for iOS without checking status
    const requestBlock = moduleSource.match(/requestCameraPermission[\s\S]*?AsyncFunction\("getNotificationPermissionStatus"\)/);
    assert.ok(requestBlock, 'Could not isolate requestCameraPermission block');
    const hasRequestAccess = requestBlock[0].includes('AVCaptureDevice.requestAccess');
    const hasStatusCheck = requestBlock[0].includes('AVCaptureDevice.authorizationStatus');
    assert.ok(hasRequestAccess, 'requestCameraPermission must call AVCaptureDevice.requestAccess');
    assert.ok(hasStatusCheck, 'requestCameraPermission must check current authorizationStatus first');
  });
});