# WakeFit Mobile

`mobile/` 是当前前端项目，已补成 Expo / React Native App。

## 开发优先级

1. **iOS** 是当前主要开发目标
2. React Native / TypeScript 共享代码应尽量同时兼容 Android 和 iOS
3. Android 与 iOS 平台能力不一致时，优先保证 iOS 后续可开发
4. Android 当前只要求保留已有功能，不要求新增能力

## 已实现

### 架构分层 (Phase 2 完成)

项目已建立正式双端分层架构：

- **Domain** (`src/domain/`): 纯 TypeScript 业务模型（真实迁移完成）
  - `alarm/`: 闹钟配置和校验逻辑
  - `challenge/`: 挑战状态机
  - `exercise/`: 俯卧撑和深蹲计数算法
  - `workout/`: 训练记录类型
- **Application** (`src/application/`): 业务流程接口 (Ports) 和 Use Cases
  - `ports/`: AlarmScheduler, Storage, WakeFitApiClient 等接口
  - `usecases/`: scheduleAlarm, cancelAlarm, recordCompletedWorkout 等
- **Infrastructure** (`src/infrastructure/`): API、Storage、Sync 实现（真实迁移完成）
  - `api/`: FetchWakeFitApiClient
  - `storage/`: MemoryStorage
  - `session/`: AppSession
  - `sync/`: WorkoutSyncQueue
- **Platform** (`src/platform/`): 原生平台能力抽象（真实迁移完成）
  - `alarm/`: DeviceLocalAlarmScheduler, DeviceAlarmAlert, ForegroundLocalAlarmScheduler
  - `camera/`: NativePoseCameraView
  - `permissions/`: PermissionService
  - `createPlatformServices.ts`: 平台服务工厂
- **Presentation** (`src/presentation/`): 共享 UI 组件
  - `screens/`: HomeTab, AlarmTab, HistoryTab, ChallengeModal
  - `styles/`: wakeFitStyles
  - `hooks/`: useWakeFitController (已完成)
- **Debug** (`src/debug/`): 开发调试工具
  - `simulation/`: demoChallenge 真实迁移完成
  - `components/`: BackendDebugTab

### 核心功能

- Expo App 入口：`App.tsx`、`index.js`、`app.json`
- 首页 Dashboard：连续天数、最长连续天数、上传队列、今日闹钟
- 闹钟设置：时间、动作类型、目标次数、启用开关、本地调度适配器
- 动作类型：`push_up` 俯卧撑、`squat` 深蹲
- 响铃和挑战流程：`idle -> ringing -> challenge -> completed`
- 挑战页：通过"模拟一次"按钮驱动真实动作计数状态机
- 完成记录：本地记录、连续天数更新、历史列表
- 后端连接：填写 API 地址、访客登录、刷新数据、上传离线队列
- 业务层测试：俯卧撑计数、深蹲计数、闹钟配置、挑战流程、API client、同步队列

### Android 真实姿态识别

- 本地 Expo Module：`modules/wakefit-pose-detector`
- CameraX 打开真机摄像头
- ML Kit Pose Detection 输出 shoulder / elbow / wrist / hip / knee / ankle
- 原生关键点通过 `NativePoseCameraView` 喂给现有动作计数器

### iOS 原生姿态识别

iOS 已存在基于 AVFoundation + Apple Vision 的原生姿态识别实现雏形。

当前工作重点是：
- 共享业务架构建立
- iOS Xcode 编译验证
- iPhone/iPad 真机验证
- 通知恢复机制
- 音频和震动集成
- 姿态识别性能调优

## UI 共享原则

**Android 与 iOS 必须使用同一套 React Native UI。**

- 不允许为 iOS 更换颜色
- 不允许为 iOS 更换字体
- 不允许为 iOS 重新布局
- 不允许使用 Platform.OS 对页面 UI 做两套渲染

平台差异仅限：
- 系统状态栏
- Safe Area
- 系统权限弹窗
- 原生摄像头 View
- 原生通知
- 原生声音和震动

## 运行

```bash
npm install
npm start
```

启动后按 Expo 终端提示，用 Expo Go 扫码或运行：

```bash
npm run android
npm run ios
npm run web
```

## 测试

```bash
npm run check
```

包括 TypeScript 类型检查和所有业务测试。

## UI 测试路径

1. 打开 App 首页
2. 点击"立即测试"
3. 点击"开始挑战"
4. 需要切换动作时，进入"闹钟"页选择"俯卧撑"或"深蹲"并保存
5. Android development build 里点击"真实相机"，对着摄像头做对应动作
6. 如果没有 dev build，可以继续点击"模拟一次"，直到达到目标次数
7. 查看完成状态和记录页
8. 如需联调后端，进入"后端"页，填写后端地址并打开"使用后端同步"

## Android 真实识别运行

Expo Go 不能加载本地 ML Kit 模块，真实识别必须使用 Android development build：

```bash
npm run prebuild:android
npm run android:dev
```

也可以单独构建 APK：

```bash
cd android
.\gradlew.bat :app:assembleDebug
```

本机需要 Android SDK 和 JDK 17。当前机器上 Gradle 会尝试通过 Foojay 自动下载 JDK 17；如果下载卡住，请先手动安装 JDK 17，再重新运行构建命令。

真机访问电脑本地后端时，通常不能填 `127.0.0.1`，需要填电脑局域网 IP，例如：

```text
http://192.168.1.20:8080
```

## 当前状态

### 移动端存储
当前使用 `MemoryStorage`，内存存储仅在 App 会话期间保持，关闭后数据丢失。

### 移动端持久化计划
下一阶段先进行 iOS 真机体验验证，后续移动端持久化**不使用 SQLite**，具体方案待定。

### 服务端
服务端未来使用 MySQL，**移动端不直接连接 MySQL**，所有数据通过 REST API 同步。

### useWakeFitController
`useWakeFitController` 已完成开发并接入，用于统一管理 WakeFit 状态和业务逻辑。

### Phase 2 完成后的下一步
Phase 2 完成后仍需 **Xcode 真机验证**，确认 iOS 原生模块编译通过。
