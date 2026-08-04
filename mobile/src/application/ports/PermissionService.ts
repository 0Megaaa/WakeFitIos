export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'not_determined' | 'unavailable';

export interface PermissionService {
  getCameraPermissionStatus(): Promise<PermissionStatus>;
  requestCameraPermission(): Promise<PermissionStatus>;
  getNotificationPermissionStatus(): Promise<PermissionStatus>;
  requestNotificationPermission(): Promise<PermissionStatus>;
}
