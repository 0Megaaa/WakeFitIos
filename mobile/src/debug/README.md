# Debug Layer

开发调试工具层。

## 目录结构

```
src/debug/
├── simulation/       # 模拟功能
│   ├── demoChallenge.ts  # 模拟挑战流程
│   └── index.ts
├── components/      # 调试组件
│   └── BackendDebugTab.tsx  # 后端调试 Tab
├── debugAvailability.ts  # 调试模式判断
└── index.ts
```

## 约束

Debug 层：

- **禁止被** Domain 层导入
- **禁止被** Application 层导入
- **禁止被** Infrastructure 层导入

## 调试模式

通过 `isDebugToolsEnabled` 判断调试模式：

```typescript
export const isDebugToolsEnabled: boolean = typeof __DEV__ !== 'undefined' && __DEV__;
```

## Tab 配置

使用 `buildWakeFitTabs(debugEnabled)` 构建 Tab：

```typescript
import { buildWakeFitTabs } from '../presentation/tabs/buildWakeFitTabs';

const tabs = buildWakeFitTabs(__DEV__);
```

## 状态

✅ demoChallenge 已从 src/ui 真实迁移到 src/debug/simulation/
✅ BackendDebugTab 已建立
✅ isDebugToolsEnabled 已实现
