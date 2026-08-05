import { getExpoNativeModule } from '../runtime/reactNativePlatformRuntime.ts';
import type { WakeFitOS } from '../runtime/reactNativePlatformRuntime.ts';
import type { PermissionService, PermissionStatus } from '../../application/ports/PermissionService.ts';

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
    return getExpoNativeModule<WakeFitPermissionModule>('WakeFitPoseDetector');
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
  platformVersion?: number | string | null;
  androidPermissions?: typeof import('react-native').PermissionsAndroid | null;
  getPermissionModule?: () => WakeFitPermissionModule | null;
};

export function createPermissionService(options: CreatePermissionServiceOptions): PermissionService {
  const { platformOS, platformVersion } = options;

  // androidPermissions: use injected value, or fall back to runtime adapter.
  // NEVER set to null when platformOS is provided - that was the bug.
  const androidPermissions = options.androidPermissions ?? (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PermissionsAndroid } = require('react-native') as { PermissionsAndroid: typeof import('react-native').PermissionsAndroid };
      return PermissionsAndroid;
    } catch {
      return null;
    }
  })();

  // getPermissionModule: use injected function, or fall back to Expo module lookup.
  const getPermissionModule = options.getPermissionModule ?? getWakeFitModule;

  function getAndroidVersion(): number | null {
    if (platformVersion === null || platformVersion === undefined) {
      return null;
    }
    const parsed = Number(platformVersion);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isAndroidBelow33(): boolean {
    const version = getAndroidVersion();
    return version !== null && version < 33;
  }

  return {
    async getCameraPermissionStatus(): Promise<PermissionStatus> {
      if (platformOS === 'web') return 'unavailable';
      if (platformOS === 'ios') {
        const mod = getPermissionModule();
        if (!mod?.getCameraPermissionStatus) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.getCameraPermissionStatus());
        } catch {
          return 'unavailable';
        }
      }
      if (platformOS !== 'android') return 'unavailable';
      if (!androidPermissions) return 'unavailable';
      try {
        const granted = await androidPermissions.check(androidPermissions.PERMISSIONS.CAMERA);
        return granted ? 'granted' : 'denied';
      } catch {
        return 'unavailable';
      }
    },

    async requestCameraPermission(): Promise<PermissionStatus> {
      if (platformOS === 'web') return 'unavailable';
      if (platformOS === 'ios') {
        const mod = getPermissionModule();
        if (!mod?.requestCameraPermission) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.requestCameraPermission());
        } catch {
          return 'unavailable';
        }
      }
      if (platformOS !== 'android') return 'unavailable';
      if (!androidPermissions) return 'unavailable';
      const result = await androidPermissions.request(androidPermissions.PERMISSIONS.CAMERA);
      return toPermissionStatus(result);
    },

    async getNotificationPermissionStatus(): Promise<PermissionStatus> {
      if (platformOS === 'web') return 'unavailable';
      if (platformOS === 'ios') {
        const mod = getPermissionModule();
        if (!mod?.getNotificationPermissionStatus) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.getNotificationPermissionStatus());
        } catch {
          return 'unavailable';
        }
      }
      if (platformOS !== 'android') return 'unavailable';
      // Android < 33: notifications are granted by default
      if (isAndroidBelow33()) return 'granted';
      if (!androidPermissions) return 'unavailable';
      try {
        const granted = await androidPermissions.check('android.permission.POST_NOTIFICATIONS' as never);
        return granted ? 'granted' : 'not_determined';
      } catch {
        return 'unavailable';
      }
    },

    async requestNotificationPermission(): Promise<PermissionStatus> {
      if (platformOS === 'web') return 'unavailable';
      if (platformOS === 'ios') {
        const mod = getPermissionModule();
        if (!mod?.requestNotificationPermission) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.requestNotificationPermission());
        } catch {
          return 'unavailable';
        }
      }
      if (platformOS !== 'android') return 'unavailable';
      // Android < 33: notifications are always granted
      if (isAndroidBelow33()) return 'granted';
      if (!androidPermissions) return 'unavailable';
      const result = await androidPermissions.request('android.permission.POST_NOTIFICATIONS' as never);
      return toPermissionStatus(result);
    },
  };
}
