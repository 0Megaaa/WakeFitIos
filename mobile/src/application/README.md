# Application Layer

业务流程接口 (Ports) 和 Use Cases 层。

## 目录结构

```
src/application/
├── ports/                    # 接口定义
│   ├── AlarmScheduler.ts     # 闹钟调度接口
│   ├── AlarmAlertService.ts  # 闹钟响铃接口
│   ├── PendingAlarmLaunchService.ts  # 设备唤醒时闹钟服务
│   ├── PermissionService.ts  # 权限服务接口
│   ├── Storage.ts           # 存储接口
│   ├── WakeFitApiClient.ts  # API 客户端接口
│   ├── WorkoutSyncQueue.ts   # 训练同步队列接口
│   ├── ForegroundAlarmEvents.ts  # 前台闹钟事件接口
│   └── index.ts
└── usecases/                 # 业务用例
    ├── scheduleAlarm.ts
    ├── cancelAlarm.ts
    ├── consumePendingAlarmLaunch.ts
    ├── recordCompletedWorkout.ts
    ├── flushWorkoutQueue.ts
    └── index.ts
```

## 约束

Application 层：

- **可以导入** Domain 层类型和函数
- **禁止导入** Infrastructure 具体实现
- **禁止导入** Platform 具体实现
- **禁止导入** React Native 组件
- **禁止导入** features/core/ui

## 接口

### AlarmScheduler

```typescript
export interface AlarmScheduler {
  schedule(request: AlarmScheduleRequest): Promise<void>;
  cancel(alarmId: string): Promise<void>;
}
```

### ForegroundAlarmEvents

```typescript
export interface ForegroundAlarmEvents {
  subscribe(listener: (event: ForegroundAlarmEvent) => void): () => void;
  emit(event: ForegroundAlarmEvent): void;
}
```

## 状态

✅ 真实迁移完成 - Application Ports 依赖 Domain 类型
✅ ForegroundAlarmEvents 接口已定义
✅ Use Cases 已建立
