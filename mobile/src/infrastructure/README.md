# Infrastructure Layer

API、Storage、Session、Sync 实现层。

## 目录结构

```
src/infrastructure/
├── api/           # HTTP API 客户端
│   ├── FetchWakeFitApiClient.ts  # Fetch 实现
│   ├── types.ts    # API DTO 类型
│   └── index.ts
├── storage/       # 本地存储
│   ├── MemoryStorage.ts  # 内存存储实现
│   └── index.ts
├── session/       # 会话管理
│   ├── appSession.ts
│   └── index.ts
├── sync/         # 离线同步队列
│   ├── createWorkoutSyncQueue.ts
│   └── index.ts
└── index.ts
```

## 约束

Infrastructure 层：

- **可以导入** Application Ports 接口
- **可以导入** Domain 层类型
- **禁止导入** Presentation 层
- **禁止导入** Debug 层
- **禁止导入** features/core/ui

## 实现

### FetchWakeFitApiClient

实现 `WakeFitApiClient` 接口，通过 Fetch 调用后端 API。

### MemoryStorage

实现 `Storage` 接口，当前为内存存储。

## 状态

✅ 真实迁移完成 - 不再从 features 重导出
✅ 实现 Application Port 接口
✅ 保持 API 协议不变
