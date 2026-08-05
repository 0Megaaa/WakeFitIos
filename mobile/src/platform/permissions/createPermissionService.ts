import { getNativeModule } from '../runtime/reactNativePlatformRuntime.ts';
import type { WakeFitOS } from '../runtime/reactNativePlatformRuntime.ts';
import type { PermissionService, PermissionStatus } from '../../application/ports/PermissionService.js';

type WakeFitPermissionModule = {
  getCameraPermissionStatus?: () => Promise<unknown>;
  requestCameraPermission?: () => Promise<unknown>;
  getNotificationPermissionStatus?: () => Promise<unknown>;
  requestNotificationPermission?: () => Promise<unknown>;
};

const VALID_STATUSES = new Set<PermissionStatus>([
  'granted',
  'denied',
  'blocked',
  'not_determined',
  'unavailable',
]);

export function normalizePermissionStatus(value: unknown): PermissionStatus {
  if (typeof value === 'string' && VALID_STATUSES.has(value as PermissionStatus)) {
    return value as PermissionStatus;
  }
  return 'unavailable';
}

function getWakeFitModule(): WakeFitPermissionModule | null {
  try {
    return getNativeModule<WakeFitPermissionModule>('WakeFitPoseDetector');
  } catch {
    return null;
  }
}

function toPermissionStatus(result: string): PermissionStatus {
  switch (result) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'blocked':
    case 'never_ask_again':
      return 'blocked';
    default:
      return 'unavailable';
  }
}

export type CreatePermissionServiceOptions = {
  platformOS: WakeFitOS;
};

export function createPermissionService(options?: CreatePermissionServiceOptions): PermissionService {
  // Only import runtime adapter when platform is not provided (test mode).
  // When platformOS is known, skip react-native imports to avoid bundler issues.
  let getOS: () => WakeFitOS;
  let getAndroidPermissions: () => typeof import('react-native').PermissionsAndroid | null;

  if (options?.platformOS) {
    getOS = () => options.platformOS!;
    getAndroidPermissions = () => null;
  } else {
    const runtime = (() => {
      try {
        return require('../runtime/reactNativePlatformRuntime.js');
      } catch {
        return null;
      }
    })();
    getOS = () => runtime?.getOS() ?? 'unknown';
    getAndroidPermissions = () => runtime?.getAndroidPermissions() ?? (() => null);
  }

  return {
    async getCameraPermissionStatus(): Promise<PermissionStatus> {
      const platform = getOS();
      if (platform === 'web') return 'unavailable';
      if (platform === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.getCameraPermissionStatus) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.getCameraPermissionStatus());
        } catch {
          return 'unavailable';
        }
      }
      if (platform !== 'android') return 'unavailable';
      const android = getAndroidPermissions();
      if (!android) return 'unavailable';
      try {
        const granted = await android.check(android.PERMISSIONS.CAMERA);
        return granted ? 'granted' : 'denied';
      } catch {
        return 'unavailable';
      }
    },

    async requestCameraPermission(): Promise<PermissionStatus> {
      const platform = getOS();
      if (platform === 'web') return 'unavailable';
      if (platform === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.requestCameraPermission) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.requestCameraPermission());
        } catch {
          return 'unavailable';
        }
      }
      if (platform !== 'android') return 'unavailable';
      const android = getAndroidPermissions();
      if (!android) return 'unavailable';
      const result = await android.request(android.PERMISSIONS.CAMERA);
      return toPermissionStatus(result);
    },

    async getNotificationPermissionStatus(): Promise<PermissionStatus> {
      const platform = getOS();
      if (platform === 'web') return 'unavailable';
      if (platform === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.getNotificationPermissionStatus) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.getNotificationPermissionStatus());
        } catch {
          return 'unavailable';
        }
      }
      if (platform !== 'android') return 'unavailable';
      const android = getAndroidPermissions();
      if (!android) return 'unavailable';
      try {
        const granted = await android.check('android.permission.POST_NOTIFICATIONS' as never);
        return granted ? 'granted' : 'not_determined';
      } catch {
        return 'unavailable';
      }
    },

    async requestNotificationPermission(): Promise<PermissionStatus> {
      const platform = getOS();
      if (platform === 'web') return 'unavailable';
      if (platform === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.requestNotificationPermission) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.requestNotificationPermission());
        } catch {
          return 'unavailable';
        }
      }
      if (platform !== 'android') return 'unavailable';
      const android = getAndroidPermissions();
      if (!android) return 'unavailable';
      const result = await android.request('android.permission.POST_NOTIFICATIONS' as never);
      return toPermissionStatus(result);
    },
  };
}
