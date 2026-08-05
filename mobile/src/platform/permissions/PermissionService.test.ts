import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizePermissionStatus, createPermissionService } from './createPermissionService.ts';
import type { PermissionStatus } from '../../application/ports/PermissionService.ts';

describe('PermissionStatus contract', () => {
  const VALID_STATUSES = new Set<PermissionStatus>(['granted', 'denied', 'blocked', 'not_determined', 'unavailable']);

  it('only allows the five canonical PermissionStatus values', () => {
    for (const status of ['granted', 'denied', 'blocked', 'not_determined', 'unavailable']) {
      assert.ok(VALID_STATUSES.has(status as PermissionStatus));
    }
    for (const status of ['', 'GRANTED', 'yes', 'unknown', 'invalid']) {
      assert.ok(!VALID_STATUSES.has(status as PermissionStatus));
    }
  });

  it('normalizePermissionStatus returns the value when valid', () => {
    assert.equal(normalizePermissionStatus('granted'), 'granted');
    assert.equal(normalizePermissionStatus('denied'), 'denied');
    assert.equal(normalizePermissionStatus('blocked'), 'blocked');
    assert.equal(normalizePermissionStatus('not_determined'), 'not_determined');
    assert.equal(normalizePermissionStatus('unavailable'), 'unavailable');
  });

  it('normalizePermissionStatus returns unavailable for invalid inputs', () => {
    assert.equal(normalizePermissionStatus(null), 'unavailable');
    assert.equal(normalizePermissionStatus(undefined), 'unavailable');
    assert.equal(normalizePermissionStatus(123), 'unavailable');
    assert.equal(normalizePermissionStatus({}), 'unavailable');
    assert.equal(normalizePermissionStatus('WRONG'), 'unavailable');
  });
});

describe('createPermissionService with Fake Runtime', () => {
  it('iOS: calls getPermissionModule for camera permission status', async () => {
    let called = false;
    const fakeModule = {
      getCameraPermissionStatus: async () => {
        called = true;
        return 'granted';
      },
    };
    const service = createPermissionService({
      platformOS: 'ios',
      getPermissionModule: () => fakeModule as never,
    });
    const status = await service.getCameraPermissionStatus();
    assert.equal(called, true);
    assert.equal(status, 'granted');
  });

  it('iOS: calls getPermissionModule for notification permission status', async () => {
    let called = false;
    const fakeModule = {
      getNotificationPermissionStatus: async () => {
        called = true;
        return 'denied';
      },
    };
    const service = createPermissionService({
      platformOS: 'ios',
      getPermissionModule: () => fakeModule as never,
    });
    const status = await service.getNotificationPermissionStatus();
    assert.equal(called, true);
    assert.equal(status, 'denied');
  });

  it('iOS: returns unavailable when getPermissionModule is null', async () => {
    const service = createPermissionService({
      platformOS: 'ios',
      getPermissionModule: () => null,
    });
    assert.equal(await service.getCameraPermissionStatus(), 'unavailable');
    assert.equal(await service.requestCameraPermission(), 'unavailable');
    assert.equal(await service.getNotificationPermissionStatus(), 'unavailable');
    assert.equal(await service.requestNotificationPermission(), 'unavailable');
  });

  it('Android: returns granted when PermissionsAndroid returns true for camera check', async () => {
    const fakeAndroid = {
      PERMISSIONS: { CAMERA: 'android.permission.CAMERA' },
      check: async () => true,
      request: async () => 'granted',
    };
    const service = createPermissionService({
      platformOS: 'android',
      androidPermissions: fakeAndroid as never,
    });
    assert.equal(await service.getCameraPermissionStatus(), 'granted');
    assert.equal(await service.requestCameraPermission(), 'granted');
  });

  it('Android: returns denied when PermissionsAndroid returns false for camera check', async () => {
    const fakeAndroid = {
      PERMISSIONS: { CAMERA: 'android.permission.CAMERA' },
      check: async () => false,
      request: async () => 'denied',
    };
    const service = createPermissionService({
      platformOS: 'android',
      androidPermissions: fakeAndroid as never,
    });
    assert.equal(await service.getCameraPermissionStatus(), 'denied');
    assert.equal(await service.requestCameraPermission(), 'denied');
  });

  it('Android: returns blocked when PermissionsAndroid returns never_ask_again', async () => {
    const fakeAndroid = {
      PERMISSIONS: { CAMERA: 'android.permission.CAMERA' },
      check: async () => false,
      request: async () => 'never_ask_again',
    };
    const service = createPermissionService({
      platformOS: 'android',
      androidPermissions: fakeAndroid as never,
    });
    assert.equal(await service.requestCameraPermission(), 'blocked');
  });

  it('Android: returns unavailable when PermissionsAndroid is null', async () => {
    const service = createPermissionService({
      platformOS: 'android',
      androidPermissions: null,
    });
    assert.equal(await service.getCameraPermissionStatus(), 'unavailable');
    assert.equal(await service.requestCameraPermission(), 'unavailable');
  });

  it('Android 32 (version < 33): notification status and request return granted', async () => {
    const fakeAndroid = {
      check: async () => false,
      request: async () => 'denied',
    };
    const service = createPermissionService({
      platformOS: 'android',
      platformVersion: 32,
      androidPermissions: fakeAndroid as never,
    });
    assert.equal(await service.getNotificationPermissionStatus(), 'granted');
    assert.equal(await service.requestNotificationPermission(), 'granted');
  });

  it('Android 33 (version >= 33): notification uses POST_NOTIFICATIONS permission', async () => {
    let requestedPermission = '';
    const fakeAndroid = {
      check: async () => false,
      request: async (permission: string) => {
        requestedPermission = permission;
        return 'granted';
      },
    };
    const service = createPermissionService({
      platformOS: 'android',
      platformVersion: 33,
      androidPermissions: fakeAndroid as never,
    });
    assert.equal(await service.requestNotificationPermission(), 'granted');
    assert.equal(requestedPermission, 'android.permission.POST_NOTIFICATIONS');
  });

  it('Web: all permission methods return unavailable', async () => {
    const service = createPermissionService({ platformOS: 'web' });
    assert.equal(await service.getCameraPermissionStatus(), 'unavailable');
    assert.equal(await service.requestCameraPermission(), 'unavailable');
    assert.equal(await service.getNotificationPermissionStatus(), 'unavailable');
    assert.equal(await service.requestNotificationPermission(), 'unavailable');
  });

  it('unknown platform: all permission methods return unavailable', async () => {
    const service = createPermissionService({ platformOS: 'unknown' });
    assert.equal(await service.getCameraPermissionStatus(), 'unavailable');
    assert.equal(await service.requestCameraPermission(), 'unavailable');
    assert.equal(await service.getNotificationPermissionStatus(), 'unavailable');
    assert.equal(await service.requestNotificationPermission(), 'unavailable');
  });
});