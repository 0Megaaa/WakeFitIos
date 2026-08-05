export { createPlatformServices } from './createPlatformServices.ts';
export type { CreatePlatformServicesOptions } from './createPlatformServices.ts';
export type { PlatformServices } from './types.ts';

export { createForegroundAlarmEvents } from './alarm/createForegroundAlarmEvents.ts';
export { createDeviceLocalAlarmScheduler, consumeDevicePendingAlarmLaunch } from './alarm/createDeviceLocalAlarmScheduler.ts';
export { createDeviceAlarmAlert } from './alarm/createDeviceAlarmAlert.ts';
export { ForegroundLocalAlarmScheduler } from './alarm/ForegroundLocalAlarmScheduler.ts';
export type { LocalAlarmScheduler, LocalAlarmScheduleRequest } from './alarm/ForegroundLocalAlarmScheduler.ts';

export { supportsNativePoseCameraPlatform } from './camera/nativePoseCameraPlatform.ts';
export { nativePoseEventToFrame, type NativePoseFrameEvent } from './camera/poseFrameAdapter.ts';
export { NativePoseCameraView } from './camera/NativePoseCameraView.tsx';

export { createPermissionService } from './permissions/createPermissionService.ts';