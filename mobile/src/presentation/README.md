# Presentation Layer

React Native UI 组件和屏幕层。

## 目录结构

```
src/presentation/
├── components/      # 通用组件
├── screens/         # 页面
│   ├── HomeTab.tsx
│   ├── AlarmTab.tsx
│   ├── HistoryTab.tsx
│   ├── ChallengeModal.tsx
│   └── WakeFitRootScreen.tsx
├── hooks/          # React Hooks
│   └── useWakeFitController.ts  # 开发中
├── camera/         # 摄像头展示逻辑
│   └── index.ts
├── styles/         # 样式
│   └── wakeFitStyles.ts
├── tabs/           # Tab 配置
│   ├── buildWakeFitTabs.ts
│   └── types.ts
└── index.ts
```

## 约束

Presentation 层：

- **禁止直接使用** requireNativeModule
- **禁止直接使用** requireNativeViewManager
- **禁止直接使用** PermissionsAndroid
- **禁止导入** Infrastructure 具体实现
- **禁止导入** features/core/ui

## UI 共享原则

Android 和 iOS 使用同一套 React Native UI：

- 不允许为 iOS 更换颜色
- 不允许为 iOS 更换字体
- 不允许使用 Platform.OS 对页面 UI 做两套渲染

## 状态

⚠️ 迁移中 - WakeFitApp.tsx 需要拆分到 screens/
✅ styles 已迁移到 wakeFitStyles.ts
✅ Tab 构建逻辑已迁移
✅ Debug 模拟功能已隔离到 debug 层
