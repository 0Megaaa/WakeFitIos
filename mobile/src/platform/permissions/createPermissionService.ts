import { Platform, PermissionsAndroid } from 'react-native';
import type { PermissionService, PermissionStatus } from '../../application/ports/PermissionService.js';

async function requestAndroidPermission(permission: string): Promise<boolean> {
  const result = await PermissionsAndroid.request(permission as never);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function createPermissionService(): PermissionService {
  return {
    async getCameraPermissionStatus(): Promise<PermissionStatus> {
      if (Platform.OS === 'ios') return 'granted';
      if (Platform.OS !== 'android') return 'unavailable';
      try {
        const result = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
        return result ? 'granted' : 'not_determined';
      } catch {
        return 'unavailable';
      }
    },

    async requestCameraPermission(): Promise<PermissionStatus> {
      if (Platform.OS === 'ios') return 'granted';
      if (Platform.OS !== 'android') return 'unavailable';
      const granted = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
      return granted ? 'granted' : 'denied';
    },

    async getNotificationPermissionStatus(): Promise<PermissionStatus> {
      if (Platform.OS !== 'android') return 'unavailable';
      if (Number(Platform.Version) < 33) return 'granted';
      try {
        const result = await PermissionsAndroid.check('android.permission.POST_NOTIFICATIONS');
        return result ? 'granted' : 'not_determined';
      } catch {
        return 'unavailable';
      }
    },

    async requestNotificationPermission(): Promise<PermissionStatus> {
      if (Platform.OS !== 'android') return 'unavailable';
      if (Number(Platform.Version) < 33) return 'granted';
      const granted = await requestAndroidPermission('android.permission.POST_NOTIFICATIONS');
      return granted ? 'granted' : 'denied';
    },
  };
}
