# Platform Layer

Native platform capabilities abstraction:
- Alarm scheduling
- Camera and pose detection
- Permissions
- Audio/visual alerts

## Platform Differences

### Android
- AlarmManager
- CameraX + ML Kit
- Notification channels

### iOS
- UserNotifications
- AVFoundation + Vision
- AVAudioSession

## Boundaries

Platform layer implements application port interfaces using native modules.
