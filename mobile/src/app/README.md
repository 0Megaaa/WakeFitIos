# App Layer

应用入口和依赖装配层。

## 入口

```
mobile/App.tsx  →  mobile/src/app/WakeFitApp.tsx  →  WakeFitRootScreen
```

## createWakeFitDependencies

```typescript
import { createWakeFitDependencies } from './createWakeFitDependencies';

const dependencies = createWakeFitDependencies();
```

返回：

```typescript
export type WakeFitDependencies = {
  storage: Storage;
  deviceId: string;
  platform: PlatformServices;
  createApiClient(options: FetchWakeFitApiClientOptions): WakeFitApiClient;
  createSyncQueue(apiClient: WakeFitApiClient): WorkoutSyncQueue;
};
```

## 约束

- 依赖对象在同一 App 生命周期内稳定
- deviceId 在同一 App 生命周期内稳定
- 不得每次 render 创建 Storage
- 不得每次 render 创建 PlatformServices

## 目标

WakeFitApp.tsx 应该成为薄入口：

```typescript
import { createWakeFitDependencies } from './createWakeFitDependencies';
import { WakeFitRootScreen } from '../presentation/screens/WakeFitRootScreen';

const dependencies = createWakeFitDependencies();

export default function WakeFitApp() {
  return <WakeFitRootScreen dependencies={dependencies} />;
}
```

## 状态

⚠️ WakeFitApp.tsx 仍需拆分 UI 到 Presentation 层
✅ createWakeFitDependencies 已实现
✅ 稳定单例已实现
✅ 前台闹钟 callback 已连接
