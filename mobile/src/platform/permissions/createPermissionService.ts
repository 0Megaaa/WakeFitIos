import { createRequire } from 'node:module';

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

let cachedWakeFitModule: WakeFitPermissionModule | null | undefined;
let localRequire: ((id: string) => unknown) | undefined;

function getRequire(): ((id: string) => unknown) {
  if (!localRequire) {
    localRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  }
  return localRequire;
}

function getWakeFitModule(): WakeFitPermissionModule | null {
  if (cachedWakeFitModule !== undefined) {
    return cachedWakeFitModule;
  }

  try {
    const { requireNativeModule } = getRequire()('expo-modules-core') as { requireNativeModule: (name: string) => unknown };
    cachedWakeFitModule = requireNativeModule('WakeFitPoseDetector') as WakeFitPermissionModule;
  } catch {
    cachedWakeFitModule = null;
  }

  return cachedWakeFitModule;
}

type RNPlatform = { OS: string; Version?: number | string };
type RNPermissionsAndroid = {
  PERMISSIONS: { CAMERA: string };
  RESULTS: { GRANTED: string };
  request: (permission: string) => Promise<string>;
  check: (permission: string) => Promise<boolean>;
};

function getRNPlatform(): RNPlatform {
  try {
    const rn = getRequire()('react-native') as { Platform: RNPlatform };
    return rn.Platform;
  } catch {
    return { OS: 'unknown' };
  }
}

function getPermissionsAndroid(): RNPermissionsAndroid | null {
  try {
    const mod = getRequire()('react-native') as { PermissionsAndroid?: RNPermissionsAndroid };
    return mod.PermissionsAndroid ?? null;
  } catch {
    return null;
  }
}

async function requestAndroidPermission(permission: string): Promise<boolean> {
  const android = getPermissionsAndroid();
  if (!android) return false;
  const result = await android.request(permission);
  return result === android.RESULTS.GRANTED;
}

export function createPermissionService(): PermissionService {
  return {
    async getCameraPermissionStatus(): Promise<PermissionStatus> {
      const platform = getRNPlatform();
      if (platform.OS === 'web') return 'unavailable';
      if (platform.OS === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.getCameraPermissionStatus) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.getCameraPermissionStatus());
        } catch {
          return 'unavailable';
        }
      }
      if (platform.OS !== 'android') return 'unavailable';
      const android = getPermissionsAndroid();
      if (!android) return 'unavailable';
      try {
        const result = await android.check(android.PERMISSIONS.CAMERA);
        return result ? 'granted' : 'not_determined';
      } catch {
        return 'unavailable';
      }
    },

    async requestCameraPermission(): Promise<PermissionStatus> {
      const platform = getRNPlatform();
      if (platform.OS === 'web') return 'unavailable';
      if (platform.OS === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.requestCameraPermission) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.requestCameraPermission());
        } catch {
          return 'unavailable';
        }
      }
      if (platform.OS !== 'android') return 'unavailable';
      const android = getPermissionsAndroid();
      if (!android) return 'unavailable';
      const granted = await android.request(android.PERMISSIONS.CAMERA);
      return granted ? 'granted' : 'denied';
    },

    async getNotificationPermissionStatus(): Promise<PermissionStatus> {
      const platform = getRNPlatform();
      if (platform.OS === 'web') return 'unavailable';
      if (platform.OS === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.getNotificationPermissionStatus) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.getNotificationPermissionStatus());
        } catch {
          return 'unavailable';
        }
      }
      if (platform.OS !== 'android') return 'unavailable';
      const version = Number(platform.Version);
      if (Number.isFinite(version) && version < 33) return 'granted';
      const android = getPermissionsAndroid();
      if (!android) return 'unavailable';
      try {
        const result = await android.check('android.permission.POST_NOTIFICATIONS');
        return result ? 'granted' : 'not_determined';
      } catch {
        return 'unavailable';
      }
    },

    async requestNotificationPermission(): Promise<PermissionStatus> {
      const platform = getRNPlatform();
      if (platform.OS === 'web') return 'unavailable';
      if (platform.OS === 'ios') {
        const mod = getWakeFitModule();
        if (!mod?.requestNotificationPermission) return 'unavailable';
        try {
          return normalizePermissionStatus(await mod.requestNotificationPermission());
        } catch {
          return 'unavailable';
        }
      }
      if (platform.OS !== 'android') return 'unavailable';
      const version = Number(platform.Version);
      if (Number.isFinite(version) && version < 33) return 'granted';
      const android = getPermissionsAndroid();
      if (!android) return 'unavailable';
      const granted = await android.request('android.permission.POST_NOTIFICATIONS');
      return granted ? 'granted' : 'denied';
    },
  };
}