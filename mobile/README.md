# WakeFit Mobile

`mobile/` 是当前前端项目，已补成 Expo / React Native App。

## 已实现

- Expo App 入口：`App.tsx`、`index.js`、`app.json`。
- 首页 Dashboard：连续天数、最长连续天数、上传队列、今日闹钟。
- 闹钟设置：时间、动作类型、目标次数、启用开关、本地调度适配器。
- 动作类型：`push_up` 俯卧撑、`squat` 深蹲。
- 响铃和挑战流程：`idle -> ringing -> challenge -> completed`。
- 挑战页：通过“模拟一次”按钮驱动真实动作计数状态机。
- 完成记录：本地记录、连续天数更新、历史列表。
- 后端连接：填写 API 地址、访客登录、刷新数据、上传离线队列。
- Android 真实姿态识别：
  - 本地 Expo Module：`modules/wakefit-pose-detector`
  - CameraX 打开真机摄像头。
  - ML Kit Pose Detection 输出 shoulder / elbow / wrist / hip / knee / ankle。
  - 原生关键点通过 `NativePoseCameraView` 喂给现有动作计数器。
- 业务层测试：俯卧撑计数、深蹲计数、闹钟配置、挑战流程、API client、同步队列。

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
npm test
npx --no-install tsc --noEmit
```

## UI 测试路径

1. 打开 App 首页。
2. 点击“立即测试”。
3. 点击“开始挑战”。
4. 需要切换动作时，进入“闹钟”页选择“俯卧撑”或“深蹲”并保存。
5. Android development build 里点击“真实相机”，对着摄像头做对应动作。
6. 如果没有 dev build，可以继续点击“模拟一次”，直到达到目标次数。
7. 查看完成状态和记录页。
8. 如需联调后端，进入“后端”页，填写后端地址并打开“使用后端同步”。

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

## 当前边界

当前 UI 是可测 MVP，Android 真实姿态识别代码已经接入；系统级本地通知、循环声音和震动仍待接入。后续需要把：

- `MemoryStorage` 换成 MMKV 或 SQLite。
- `MemoryLocalAlarmScheduler` 换成 Android/iOS 本地通知和闹钟调度。
- iOS 侧接 MediaPipe Pose 或 ML Kit 等效方案。 iOS 已存在基于 AVFoundation + Apple Vision 的原生姿态识别实现雏形，但尚未完成 Xcode 编译、iPhone 真机和 iPad 真机验证。
- 完成挑战后接入真实循环声音和震动停止逻辑。
