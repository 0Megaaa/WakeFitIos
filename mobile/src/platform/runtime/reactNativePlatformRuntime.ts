/**
 * Platform Runtime Adapter
 *
 * This module provides React Native / Expo imports for the platform layer.
 * All imports are fully lazy to avoid Node.js bundler issues in tests.
 */

export type WakeFitOS = 'ios' | 'android' | 'web' | 'unknown';

const SUPPORTED_OS: WakeFitOS[] = ['ios', 'android', 'web'];

export function getOS(): WakeFitOS {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    const os = Platform.OS;
    return SUPPORTED_OS.includes(os as WakeFitOS) ? (os as WakeFitOS) : 'unknown';
  } catch {
    return 'unknown';
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

export function getNativeModule<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireNativeModule } = require('expo-modules-core') as { requireNativeModule: (name: string) => T };
  return requireNativeModule(name);
}
