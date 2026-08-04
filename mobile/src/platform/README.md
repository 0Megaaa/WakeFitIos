# Platform Layer

## Responsibilities

- Camera abstraction
- Pose Detection abstraction
- Alarm Scheduler abstraction
- Alarm Audio abstraction
- Permissions abstraction
- App Lifecycle abstraction
- Notification abstraction
- Store Purchase abstraction
- Android/iOS Adapter
- Expo Native Module Bridge

## Platform Boundaries

### Android-specific capabilities

- AlarmManager
- BroadcastReceiver
- Full Screen Intent
- WakeLock
- CameraX
- ML Kit
- Android Notification Channel

### iOS-specific capabilities

- UserNotifications
- AVFoundation
- Vision framework
- AVAudioSession
- iOS App lifecycle
- iOS permission handling

### Shared capabilities

- Alarm domain model
- Challenge state machine
- Workout model
- Streak model
- Exercise counting business rules
- API DTOs
- Sync rules
- Page structure

## Interface Examples

```typescript
interface AlarmScheduler {
  schedule(...): Promise<void>;
  cancel(...): Promise<void>;
}

interface AlarmAudioService {
  start(...): Promise<void>;
  stop(): Promise<void>;
}

interface PoseCameraService {
  isAvailable(): boolean;
}

interface PermissionService {
  getCameraStatus(): Promise<PermissionStatus>;
  requestCamera(): Promise<PermissionStatus>;
}
```

## Forbidden

Pages MUST NOT directly call:
- requireNativeModule
- requireNativeViewManager
- NativeModules
- Kotlin code
- Swift code
