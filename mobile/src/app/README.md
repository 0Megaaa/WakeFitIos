# App Layer

应用入口和依赖装配。

## 职责

- 应用组合入口 (`WakeFitApp.tsx`)
- 依赖创建工厂 (`createWakeFitDependencies.ts`)
- 类型定义 (`types.ts`)

## WakeFitApp.tsx

WakeFitApp 是 React Native 应用的主入口，负责渲染根屏幕。

当前 WakeFitApp 包含完整的 UI 实现。后续阶段将逐步拆分到 Presentation 层。

## createWakeFitDependencies

负责创建和管理应用依赖：

- Storage 单例
- API Client 工厂
- Platform Services
- Sync Queue
- Device ID

## 禁止事项

- 不得在模块级多次创建 Storage
- 不得每次 render 都重新生成 deviceId
- 不得直接 import 平台实现
