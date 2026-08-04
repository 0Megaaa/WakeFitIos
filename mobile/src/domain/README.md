# Domain Layer

纯 TypeScript 业务模型和领域逻辑。

## 职责

- 业务实体定义 (Alarm, Challenge, Exercise, Workout)
- 领域逻辑 (Push-up Counter, Squat Classifier)
- 业务规则验证
- 跨平台通用类型

## 边界

Domain 代码**不得**导入：
- `react`
- `react-native`
- `expo-modules-core`
- 平台特定实现
- Infrastructure 实现
- Platform 实现
- Presentation 实现
- Debug 实现

## 内容

### alarm/

闹钟业务模型：
- `alarm.ts`: 闹钟配置创建和更新

### exercise/

动作计数器和分类器：
- `pushupCounter.ts`: 俯卧撑计数器
- `squatCounter.ts`: 深蹲计数器
- `squatPoseClassifier.ts`: 深蹲姿态分类

### challenge/

挑战流程状态机：
- `challenge.ts`: 挑战状态流转

### workout/

训练记录相关：
- 包含在 Challenge 中

## 保持原样

当前 Domain 层代码保留在 `src/core/` 和 `src/features/` 中，通过正式分层目录提供类型重导出和边界定义。
