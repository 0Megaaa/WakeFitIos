# Domain Layer

纯 TypeScript 业务模型层，不依赖任何框架或平台。

## 目录结构

```
src/domain/
├── alarm/           # 闹钟配置和校验
│   ├── alarm.ts     # createAlarmConfig, updateAlarmConfig, normalizeTargetCount
│   ├── types.ts     # LocalAlarmConfig, CreateAlarmConfigInput, UpdateAlarmConfigInput
│   └── index.ts
├── challenge/       # 挑战状态机
│   ├── challengeFlow.ts  # createChallengeFlow
│   ├── types.ts    # ChallengeSnapshot, ChallengeFlowOptions, ChallengeStatus
│   └── index.ts
├── exercise/        # 动作计数算法
│   ├── pushupCounter.ts   # createPushUpCounter, calculateAngle
│   ├── squatPoseClassifier.ts  # classifySquatPoseFrame
│   ├── types.ts    # PoseFrame, PoseLandmark, ExerciseType
│   └── index.ts
├── workout/         # 训练记录
│   ├── types.ts    # ApiWorkoutUpload, CalendarWorkout, StreakSummary
│   └── index.ts
└── index.ts
```

## 约束

Domain 层严格禁止导入：

- `react`
- `react-native`
- `expo`
- `expo-modules-core`
- `Platform`
- `src/application/`
- `src/infrastructure/`
- `src/platform/`
- `src/presentation/`
- `src/debug/`
- `src/features/`
- `src/core/`
- `src/ui/`

## 类型

### ExerciseType

```typescript
export type ExerciseType = 'push_up' | 'squat';
```

### PoseFrame

```typescript
export type PoseFrame = {
  timestampMs: number;
  imageWidth?: number;
  imageHeight?: number;
  landmarks: PoseLandmark[];
};
```

### LocalAlarmConfig

```typescript
export type LocalAlarmConfig = {
  id: string;
  serverId?: number;
  label: string;
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  targetCount: number;
  exerciseType: ExerciseType;
  createdAt: string;
  updatedAt: string;
};
```

### ChallengeSnapshot

```typescript
export type ChallengeSnapshot = {
  status: ChallengeStatus;
  exerciseType: ExerciseType;
  targetCount: number;
  currentCount: number;
  startedAt: string | null;
  completedAt: string | null;
};
```

## 导出

所有公共类型和函数通过 `src/domain/index.ts` 导出。

## 状态

✅ 真实迁移完成 - Domain 层不依赖 features/core/ui
