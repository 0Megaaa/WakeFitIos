# Platform Layer

原生平台能力抽象层。

## 目录结构

```
src/platform/
├── alarm/           # 闹钟相关平台能力
│   ├── createDeviceLocalAlarmScheduler.ts  # 设备闹钟调度
│   ├── createDeviceAlarmAlert.ts          # 设备闹钟响铃
│   ├── ForegroundLocalAlarmScheduler.ts   # 前台闹钟调度
│   ├── nativeAlarmBridge.ts              # 原生闹钟桥接
│   ├── createForegroundAlarmEvents.ts    # 前台闹钟事件
│   └── index.ts
├── camera/         # 摄像头相关平台能力
│   ├── NativePoseCameraView.tsx  # 原生姿态摄像头
│   ├── nativePoseCameraPlatform.ts
│   ├── poseFrameAdapter.ts
│   └── index.ts
├── permissions/   # 权限相关
│   ├── createPermissionService.ts
│   └── index.ts
├── createPlatformServices.ts  # 平台服务工厂
└── index.ts
```

## 约束

Platform 层：

- **可以导入** Application Ports 接口
- **可以导入** Domain 层类型
- **允许使用** requireNativeModule (expo-modules-core)
- **允许使用** requireNativeViewManager
- **允许使用** Platform.OS
- **禁止导入** Presentation 层
- **禁止导入** Infrastructure 层
- **禁止导入** features/core/ui

## createPlatformServices

```typescript
export function createPlatformServices(): PlatformServices
```

返回：

```typescript
export type PlatformServices = {
  alarmScheduler: AlarmScheduler;
  alarmAlertService: AlarmAlertService;
  pendingAlarmLaunchService: PendingAlarmLaunchService;
  foregroundAlarmEvents: ForegroundAlarmEvents;
  permissionService: PermissionService;
  poseCamera: { supported: boolean };
};
```

## 状态

✅ 真实迁移完成 - 不再从 features 重导出
✅ ForegroundAlarmEvents 实现已连接
✅ 前台闹钟 callback 不再为空
✅ PermissionService 已实现
✅ createPlatformServices 已实现
