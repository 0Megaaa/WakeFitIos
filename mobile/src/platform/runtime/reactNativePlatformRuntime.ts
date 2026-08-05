/**
 * Platform Runtime Adapter
 *
 * This module provides React Native / Expo imports for the platform layer.
 * All imports are fully lazy to avoid Node.js bundler issues in tests.
 */

export type WakeFitOS = 'ios' | 'android' | 'web' | 'unknown';

const SUPPORTED_OS: WakeFitOS[] = ['ios', 'android', 'web'];

function normalizeWakeFitOS(os: string): WakeFitOS {
  return SUPPORTED_OS.includes(os as WakeFitOS) ? (os as WakeFitOS) : 'unknown';
}

export function getOS(): WakeFitOS {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    return normalizeWakeFitOS(Platform.OS);
  } catch {
    return 'unknown';
  }
}

export function getOSVersion(): number | string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as { Platform: { Version?: number | string } };
    return Platform.Version ?? null;
  } catch {
    return null;
  }
}

export function getAndroidPermissions(): typeof import('react-native').PermissionsAndroid | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PermissionsAndroid } = require('react-native') as { PermissionsAndroid: typeof import('react-native').PermissionsAndroid };
    return PermissionsAndroid;
  } catch {
    return null;
  }
}

export function getVibration(): typeof import('react-native').Vibration | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Vibration } = require('react-native') as { Vibration: typeof import('react-native').Vibration };
    return Vibration;
  } catch {
    return null;
  }
}

export function getReactNativeModules(): object | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native') as { NativeModules: object };
    return NativeModules;
  } catch {
    return null;
  }
}

export function getExpoNativeModule<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireNativeModule } = require('expo-modules-core') as { requireNativeModule: (name: string) => T };
  return requireNativeModule(name);
}
