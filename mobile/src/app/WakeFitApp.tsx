import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createAlarmConfig, updateAlarmConfig, type ExerciseType, type LocalAlarmConfig } from '../features/alarms.ts';
import {
  FetchWakeFitApiClient,
  type ApiAlarm,
  type ApiWorkoutUpload,
  type CalendarWorkout,
  type StreakSummary,
} from '../features/api.ts';
import { shouldRenderInlineCamera, shouldUseCameraFirstChallengeLayout } from '../features/cameraPresentation.ts';
import { createChallengeFlow, type ChallengeSnapshot } from '../features/challenge.ts';
import { createDeviceAlarmAlert } from '../features/deviceAlarmAlert.ts';
import { consumeDevicePendingAlarmLaunch, createDeviceLocalAlarmScheduler } from '../features/deviceLocalAlarm.ts';
import { ForegroundLocalAlarmScheduler } from '../features/localAlarm.ts';
import type { LocalAlarmScheduler } from '../features/localAlarm.ts';
import { NativePoseCameraView } from '../features/nativePoseCamera.tsx';
import { supportsNativePoseCameraPlatform } from '../features/nativePoseCameraPlatform.ts';
import { MemoryStorage } from '../features/storage.ts';
import { createWorkoutSyncQueue } from '../features/syncQueue.ts';
import { driveOneSimulatedExercise } from '../ui/demoChallenge.ts';
import type { PoseFrame } from '../core/pushupCounter.ts';

type Tab = 'home' | 'alarm' | 'history' | 'backend';
type ChallengeFlow = ReturnType<typeof createChallengeFlow>;

const storage = new MemoryStorage();
const deviceId = `wakefit-demo-${Math.random().toString(36).slice(2)}`;

const initialStreak: StreakSummary = {
  currentDays: 0,
  longestDays: 0,
  lastCompletedDate: null,
};

export default function WakeFitApp() {
  const [tab, setTab] = useState<Tab>('home');
  const [alarm, setAlarm] = useState<LocalAlarmConfig>(() =>
    createAlarmConfig({
      id: 'alarm-demo-1',
      label: '晨间训练',
      timeOfDay: '07:30',
      targetCount: 5,
      timezone: getLocalTimezone(),
    }),
  );
  const [timeDraft, setTimeDraft] = useState('07:30');
  const [targetDraft, setTargetDraft] = useState('5');
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseType>('squat');
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [flow, setFlow] = useState<ChallengeFlow | null>(null);
  const [snapshot, setSnapshot] = useState<ChallengeSnapshot | null>(null);
  const [streak, setStreak] = useState<StreakSummary>(initialStreak);
  const [workouts, setWorkouts] = useState<CalendarWorkout[]>([]);
  const [backendEnabled, setBackendEnabled] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [status, setStatus] = useState('本地模式已就绪');
  const [busy, setBusy] = useState(false);
  const [realCameraEnabled, setRealCameraEnabled] = useState(false);
  const [nextFireAt, setNextFireAt] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const recordedWorkoutIDs = useRef(new Set<string>());
  const consumedAlarmLaunches = useRef(new Set<string>());
  const handledAlarmFireKeys = useRef(new Set<string>());
  const alarmRef = useRef<LocalAlarmConfig | null>(null);
  const alarmAlertRef = useRef(createDeviceAlarmAlert());
  const schedulerRef = useRef<LocalAlarmScheduler | null>(null);

  alarmRef.current = alarm;
  if (!schedulerRef.current) {
    const foregroundScheduler = new ForegroundLocalAlarmScheduler({
      onFire: (request) => {
        const currentAlarm = alarmRef.current;
        if (!currentAlarm || !currentAlarm.enabled || currentAlarm.id !== request.alarmId) {
          return;
        }

        startAlarmFlow(currentAlarm, request.fireAt);
        const nextFire = getNextFireAt(currentAlarm.timeOfDay);
        setNextFireAt(nextFire);
        void schedulerRef.current?.schedule({
          alarmId: currentAlarm.id,
          fireAt: nextFire,
          label: currentAlarm.label,
          timeOfDay: currentAlarm.timeOfDay,
          targetCount: currentAlarm.targetCount,
          exerciseType: currentAlarm.exerciseType,
        });
      },
    });
    schedulerRef.current = createDeviceLocalAlarmScheduler(foregroundScheduler);
  }

  const apiClient = useMemo(
    () =>
      new FetchWakeFitApiClient({
        baseUrl: normalizeBackendUrl(backendUrl) || 'http://127.0.0.1:8080',
        getAuthToken: () => tokenRef.current,
      }),
    [backendUrl],
  );
  const syncQueue = useMemo(
    () =>
      createWorkoutSyncQueue({
        storage,
        apiClient,
      }),
    [apiClient],
  );

  const challengeStatus = snapshot?.status ?? 'idle';
  const activeExerciseLabel = getExerciseLabel(snapshot?.exerciseType ?? alarm.exerciseType);
  const progressPercent = snapshot
    ? Math.min(100, Math.round((snapshot.count / snapshot.targetCount) * 100))
    : 0;
  const alarmModalVisible = flow !== null && challengeStatus !== 'idle';
  const inlineCameraVisible = shouldRenderInlineCamera({ realCameraEnabled, alarmModalVisible });

  useEffect(() => {
    if (!alarm.enabled) {
      setNextFireAt(null);
      void schedulerRef.current?.cancel(alarm.id);
      return;
    }

    const nextFire = getNextFireAt(alarm.timeOfDay);
    setNextFireAt(nextFire);
    void schedulerRef.current?.schedule({
      alarmId: alarm.id,
      fireAt: nextFire,
      label: alarm.label,
      timeOfDay: alarm.timeOfDay,
      targetCount: alarm.targetCount,
      exerciseType: alarm.exerciseType,
    });

    return () => {
      void schedulerRef.current?.cancel(alarm.id);
    };
  }, [alarm.enabled, alarm.exerciseType, alarm.id, alarm.label, alarm.targetCount, alarm.timeOfDay]);

  useEffect(() => {
    if (challengeStatus === 'ringing' || challengeStatus === 'challenge') {
      void alarmAlertRef.current.start();
      return;
    }

    void alarmAlertRef.current.stop();
  }, [challengeStatus]);

  useEffect(() => {
    return () => {
      void alarmAlertRef.current.stop();
    };
  }, []);

  useEffect(() => {
    void consumePendingNativeAlarm();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void consumePendingNativeAlarm();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  async function ensureGuestSession() {
    const baseUrl = normalizeBackendUrl(backendUrl);
    if (!baseUrl) {
      throw new Error('请先填写后端地址');
    }
    if (tokenRef.current) {
      return tokenRef.current;
    }

    const session = await apiClient.guestLogin({ deviceId });
    tokenRef.current = session.token;
    setToken(session.token);
    return session.token;
  }

  async function saveAlarm() {
    setBusy(true);
    try {
      const nextAlarm = updateAlarmConfig(alarm, {
        timeOfDay: normalizeTimeOfDay(timeDraft, alarm.timeOfDay),
        enabled: alarmEnabled,
        exerciseType: exerciseDraft,
        targetCount: Number.parseInt(targetDraft, 10),
      });

      if (nextAlarm.enabled) {
        await requestAlarmNotificationPermission();
      }

      setAlarm(nextAlarm);
      setTimeDraft(nextAlarm.timeOfDay);
      setTargetDraft(String(nextAlarm.targetCount));

      if (backendEnabled) {
        const syncedAlarm = await syncAlarm(nextAlarm);
        setAlarm(syncedAlarm);
        setStatus('闹钟已保存并同步后端');
      } else {
        setStatus(nextAlarm.enabled ? '闹钟已交给系统调度' : '闹钟已关闭');
      }

      setTab('home');
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function syncAlarm(input: LocalAlarmConfig): Promise<LocalAlarmConfig> {
    await ensureGuestSession();
    const payload = toApiAlarm(input);
    const remote = input.serverId
      ? await apiClient.updateAlarm(input.serverId, payload)
      : await apiClient.createAlarm(payload);

    return updateAlarmConfig(input, {
      serverId: remote.id,
      timeOfDay: remote.timeOfDay,
      timezone: remote.timezone,
      enabled: remote.enabled,
      targetCount: remote.targetCount,
      exerciseType: remote.exerciseType,
    });
  }

  function startAlarmFlow(input: LocalAlarmConfig, fireAt = new Date().toISOString(), dedupeScheduledFire = true) {
    const firedAtMillis = Date.parse(fireAt);
    if (dedupeScheduledFire && !Number.isNaN(firedAtMillis)) {
      const fireKey = `${input.id}:${Math.floor(firedAtMillis / 60_000)}`;
      if (handledAlarmFireKeys.current.has(fireKey)) {
        return;
      }
      handledAlarmFireKeys.current.add(fireKey);
    }

    const nextFlow = createChallengeFlow({
      alarmId: input.serverId ?? 1,
      targetCount: input.targetCount,
      exerciseType: input.exerciseType,
      startedAt: fireAt,
      workoutDate: getTodayLocalDate(),
    });
    setFlow(nextFlow);
    setSnapshot(nextFlow.startRinging(fireAt));
    setRealCameraEnabled(false);
    setTab('home');
    setStatus('闹钟响铃中，完成动作后才能关闭');
  }

  function startRingingNow() {
    startAlarmFlow(alarm, new Date().toISOString(), false);
  }

  async function consumePendingNativeAlarm() {
    const launch = await consumeDevicePendingAlarmLaunch();
    if (!launch) {
      return;
    }

    const launchKey = `${launch.alarmId}:${launch.firedAt}`;
    if (consumedAlarmLaunches.current.has(launchKey)) {
      return;
    }
    consumedAlarmLaunches.current.add(launchKey);

    const currentAlarm = alarmRef.current;
    const launchAlarm = currentAlarm && currentAlarm.id === launch.alarmId
      ? currentAlarm
      : createAlarmConfig({
        id: launch.alarmId,
        label: launch.label || 'WakeFit 闹钟',
        timeOfDay: launch.timeOfDay || normalizeTimeOfDay(launch.firedAt.slice(11, 16), '07:30'),
        targetCount: launch.targetCount,
        exerciseType: launch.exerciseType,
        timezone: getLocalTimezone(),
      });

    startAlarmFlow(launchAlarm, launch.firedAt);
  }

  function beginChallenge() {
    if (!flow) {
      return;
    }
    setSnapshot(flow.beginChallenge());
    setStatus('挑战已开始');
  }

  function simulateOnePushUp() {
    if (!flow || snapshot?.status !== 'challenge') {
      return;
    }

    const nextSnapshot = driveOneSimulatedExercise(flow, snapshot.exerciseType);
    setSnapshot(nextSnapshot);

    if (nextSnapshot.status === 'completed' && nextSnapshot.workout) {
      void recordCompletedWorkout(nextSnapshot.workout);
    }
  }

  async function toggleRealCamera() {
    if (realCameraEnabled) {
      setRealCameraEnabled(false);
      setStatus('真实相机已关闭');
      return;
    }

    if (!supportsNativePoseCameraPlatform(Platform.OS)) {
      setStatus('真实识别当前先接 Android development build');
      return;
    }

    const granted = await requestCameraPermission();
    if (!granted) {
      setStatus('没有摄像头权限，无法开启真实识别');
      return;
    }

    setRealCameraEnabled(true);
    setStatus('真实相机识别已开启');
  }

  function handleRealPoseFrame(frame: PoseFrame) {
    if (!flow) {
      return;
    }

    const currentSnapshot = flow.getSnapshot();
    if (currentSnapshot.status !== 'challenge') {
      return;
    }

    const nextSnapshot = flow.handlePoseFrame(frame);
    setSnapshot(nextSnapshot);

    if (nextSnapshot.status === 'completed' && nextSnapshot.workout) {
      void recordCompletedWorkout(nextSnapshot.workout);
    }
  }

  function resetChallenge() {
    flow?.reset();
    setFlow(null);
    setSnapshot(null);
    setRealCameraEnabled(false);
    setStatus('挑战已重置');
  }

  function closeCompletedAlarm() {
    if (snapshot?.status !== 'completed') {
      return;
    }

    setFlow(null);
    setSnapshot(null);
    setRealCameraEnabled(false);
    setStatus('闹钟已关闭，训练已完成');
  }

  async function recordCompletedWorkout(workout: ApiWorkoutUpload) {
    if (recordedWorkoutIDs.current.has(workout.id)) {
      return;
    }
    recordedWorkoutIDs.current.add(workout.id);

    const localWorkout: CalendarWorkout = {
      id: Date.now(),
      alarmId: workout.alarmId,
      workoutDate: workout.workoutDate,
      exerciseType: workout.exerciseType,
      targetCount: workout.targetCount,
      actualCount: workout.actualCount,
      completed: workout.completed,
    };
    setWorkouts((items) => mergeWorkout(localWorkout, items));
    setStreak((current) => updateLocalStreak(current, workout.workoutDate));

    if (!backendEnabled) {
      setStatus('训练已记录，本地模式未上传');
      return;
    }

    setBusy(true);
    try {
      try {
        await ensureGuestSession();
      } catch {
        // The queue still records the workout if the backend is unreachable.
      }
      const result = await syncQueue.recordWorkout(workout);
      setQueuedCount(result.queuedCount);
      setStatus(result.uploaded ? `训练已上传，后端记录 #${result.uploadResult?.id}` : `后端不可用，已加入上传队列 ${result.queuedCount} 条`);
    } finally {
      setBusy(false);
    }
  }

  async function loginBackend() {
    setBusy(true);
    try {
      await ensureGuestSession();
      setStatus('访客登录成功');
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshDashboard() {
    setBusy(true);
    try {
      await ensureGuestSession();
      const month = getCurrentMonthKey();
      const [nextStreak, calendar] = await Promise.all([
        apiClient.fetchStreak(),
        apiClient.fetchCalendar({ month }),
      ]);
      setStreak(nextStreak);
      setWorkouts(calendar.workouts);
      setStatus(`已刷新 ${month} 记录`);
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function flushQueue() {
    setBusy(true);
    try {
      try {
        await ensureGuestSession();
      } catch {
        // Flush will report remaining items if upload still cannot complete.
      }
      const result = await syncQueue.flush();
      setQueuedCount(result.remainingCount);
      setStatus(`队列上传 ${result.uploadedCount} 条，剩余 ${result.remainingCount} 条`);
      if (result.uploadedCount > 0) {
        await refreshDashboard();
      }
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0e14" />
      <AlarmChallengeModal
        visible={alarmModalVisible}
        snapshot={snapshot}
        statusText={status}
        activeExerciseLabel={activeExerciseLabel}
        progressPercent={progressPercent}
        realCameraEnabled={realCameraEnabled}
        busy={busy}
        onBeginChallenge={beginChallenge}
        onToggleRealCamera={toggleRealCamera}
        onSimulateOne={simulateOnePushUp}
        onPoseFrame={handleRealPoseFrame}
        onCameraError={(message) => setStatus(`真实识别错误：${message}`)}
        onCloseCompleted={closeCompletedAlarm}
      />
      <View style={styles.appShell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>WakeFit</Text>
            <Text style={styles.headerMeta}>健身闹钟 MVP</Text>
          </View>
          <StatusPill label={backendEnabled ? '后端同步' : '本地演示'} tone={backendEnabled ? 'blue' : 'green'} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {tab === 'home' && (
            <>
              <View style={styles.metricsGrid}>
                <Metric label="连续" value={`${streak.currentDays} 天`} tone="green" />
                <Metric label="最长" value={`${streak.longestDays} 天`} tone="blue" />
                <Metric label="队列" value={`${queuedCount} 条`} tone="gold" />
              </View>

              <Section title="今日闹钟">
                <View style={styles.alarmSummary}>
                  <View>
                    <Text style={styles.clockText}>{alarm.timeOfDay}</Text>
                    <Text style={styles.subtleText}>{alarm.enabled ? '已开启' : '已关闭'} · {alarm.targetCount} 次{getExerciseLabel(alarm.exerciseType)}</Text>
                    <Text style={styles.subtleText}>{alarm.enabled && nextFireAt ? `下次响铃 ${formatNextFireAt(nextFireAt)}` : '闹钟未排程'}</Text>
                  </View>
                  <AppButton label="立即测试" onPress={startRingingNow} />
                </View>
              </Section>

              <Section title="挑战">
                {challengeStatus === 'idle' && (
                  <EmptyState title="等待响铃" detail="点击立即测试可进入完整挑战流程。" />
                )}

                {challengeStatus === 'ringing' && (
                  <View style={styles.challengePanel}>
                    <Text style={styles.ringingTitle}>闹钟响铃</Text>
                    <Text style={styles.subtleText}>目标 {snapshot?.targetCount} 次，完成后结束。</Text>
                    <View style={styles.buttonRow}>
                      <AppButton label="开始挑战" onPress={beginChallenge} />
                      <AppButton label="重置" variant="secondary" onPress={resetChallenge} />
                    </View>
                  </View>
                )}

                {challengeStatus === 'challenge' && (
                  <View style={styles.challengePanel}>
                    {inlineCameraVisible ? (
                      <NativePoseCameraView
                        style={styles.cameraPreview}
                        cameraFacing="front"
                        onPoseFrame={handleRealPoseFrame}
                        onCameraError={(message) => setStatus(`真实识别错误：${message}`)}
                        fallback={
                          <View style={styles.cameraFallback}>
                            <Text style={styles.emptyTitle}>真实相机未加载</Text>
                            <Text style={styles.subtleText}>请使用 Android development build 测试 ML Kit 识别。</Text>
                          </View>
                        }
                      />
                    ) : (
                      <PosePreview progress={progressPercent} />
                    )}
                    <View style={styles.progressHeader}>
                      <Text style={styles.progressText}>{snapshot?.count ?? 0}/{snapshot?.targetCount ?? alarm.targetCount}</Text>
                      <Text style={styles.subtleText}>{activeExerciseLabel}</Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                    </View>
                    <View style={styles.buttonRow}>
                      <AppButton label={realCameraEnabled ? '关闭相机' : '真实相机'} variant="secondary" onPress={toggleRealCamera} disabled={busy} />
                      <AppButton label="模拟一次" onPress={simulateOnePushUp} disabled={busy} />
                      <AppButton label="重置" variant="secondary" onPress={resetChallenge} />
                    </View>
                  </View>
                )}

                {challengeStatus === 'completed' && (
                  <View style={styles.challengePanel}>
                    <Text style={styles.completedTitle}>挑战完成</Text>
                    <Text style={styles.progressText}>{snapshot?.count}/{snapshot?.targetCount}</Text>
                    <Text style={styles.subtleText}>{snapshot?.workout?.workoutDate} · {status}</Text>
                    <View style={styles.buttonRow}>
                      <AppButton label="再测一次" onPress={startRingingNow} />
                      <AppButton label="查看记录" variant="secondary" onPress={() => setTab('history')} />
                    </View>
                  </View>
                )}
              </Section>

              <Text style={styles.statusText}>{status}</Text>
            </>
          )}

          {tab === 'alarm' && (
            <Section title="闹钟设置">
              <Field label="时间">
                <TextInput
                  style={styles.input}
                  value={timeDraft}
                  onChangeText={setTimeDraft}
                  placeholder="07:30"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </Field>
              <Field label="目标次数">
                <View style={styles.stepper}>
                  <AppButton label="-1" variant="secondary" onPress={() => setTargetDraft(String(Math.max(1, Number.parseInt(targetDraft || '1', 10) - 1)))} />
                  <TextInput
                    style={[styles.input, styles.stepperInput]}
                    value={targetDraft}
                    onChangeText={setTargetDraft}
                    keyboardType="number-pad"
                    maxLength={3}
                  />
                  <AppButton label="+1" variant="secondary" onPress={() => setTargetDraft(String(Math.min(100, Number.parseInt(targetDraft || '0', 10) + 1)))} />
                </View>
              </Field>
              <Field label="动作">
                <View style={styles.exerciseOptions}>
                  <ExerciseOption
                    label="俯卧撑"
                    active={exerciseDraft === 'push_up'}
                    onPress={() => setExerciseDraft('push_up')}
                  />
                  <ExerciseOption
                    label="深蹲"
                    active={exerciseDraft === 'squat'}
                    onPress={() => setExerciseDraft('squat')}
                  />
                </View>
              </Field>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.fieldLabel}>启用闹钟</Text>
                  <Text style={styles.subtleText}>{alarm.timezone}</Text>
                </View>
                <Switch value={alarmEnabled} onValueChange={setAlarmEnabled} trackColor={{ false: '#26303f', true: 'rgba(229, 72, 77, 0.5)' }} thumbColor={alarmEnabled ? '#e5484d' : '#8b95a8'} />
              </View>
              <View style={styles.buttonRow}>
                <AppButton label={busy ? '保存中' : '保存'} onPress={saveAlarm} disabled={busy} />
                <AppButton label="返回首页" variant="secondary" onPress={() => setTab('home')} />
              </View>
              <Text style={styles.statusText}>{status}</Text>
            </Section>
          )}

          {tab === 'history' && (
            <>
              <Section title="训练记录">
                {workouts.length === 0 ? (
                  <EmptyState title="暂无记录" detail="完成一次挑战后会出现在这里。" />
                ) : (
                  workouts.map((item) => (
                    <View key={`${item.id}-${item.workoutDate}`} style={styles.workoutRow}>
                      <View>
                        <Text style={styles.workoutDate}>{item.workoutDate}</Text>
                        <Text style={styles.subtleText}>{item.completed ? '已完成' : '未完成'} · {getExerciseLabel(item.exerciseType)}</Text>
                      </View>
                      <Text style={styles.workoutCount}>{item.actualCount}/{item.targetCount}</Text>
                    </View>
                  ))
                )}
              </Section>
              <View style={styles.buttonRow}>
                <AppButton label="刷新后端" variant="secondary" onPress={refreshDashboard} disabled={busy || !backendEnabled} />
                <AppButton label="返回首页" onPress={() => setTab('home')} />
              </View>
            </>
          )}

          {tab === 'backend' && (
            <Section title="后端连接">
              <Field label="API 地址">
                <TextInput
                  style={styles.input}
                  value={backendUrl}
                  onChangeText={setBackendUrl}
                  placeholder="http://192.168.1.20:8080"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </Field>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.fieldLabel}>使用后端同步</Text>
                  <Text style={styles.subtleText}>{token ? '访客 token 已存在' : '尚未登录'}</Text>
                </View>
                <Switch value={backendEnabled} onValueChange={setBackendEnabled} trackColor={{ false: '#26303f', true: 'rgba(91, 141, 239, 0.5)' }} thumbColor={backendEnabled ? '#5b8def' : '#8b95a8'} />
              </View>
              <View style={styles.buttonRow}>
                <AppButton label="访客登录" onPress={loginBackend} disabled={busy || !backendEnabled} />
                <AppButton label="刷新数据" variant="secondary" onPress={refreshDashboard} disabled={busy || !backendEnabled} />
              </View>
              <View style={styles.buttonRow}>
                <AppButton label="上传队列" variant="secondary" onPress={flushQueue} disabled={busy || !backendEnabled} />
                <AppButton label="本地模式" variant="quiet" onPress={() => setBackendEnabled(false)} />
              </View>
              <Text style={styles.statusText}>{status}</Text>
            </Section>
          )}
        </ScrollView>

        <View style={styles.tabs}>
          <TabButton active={tab === 'home'} label="首页" onPress={() => setTab('home')} />
          <TabButton active={tab === 'alarm'} label="闹钟" onPress={() => setTab('alarm')} />
          <TabButton active={tab === 'history'} label="记录" onPress={() => setTab('history')} />
          <TabButton active={tab === 'backend'} label="后端" onPress={() => setTab('backend')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

type AlarmChallengeModalProps = {
  visible: boolean;
  snapshot: ChallengeSnapshot | null;
  statusText: string;
  activeExerciseLabel: string;
  progressPercent: number;
  realCameraEnabled: boolean;
  busy: boolean;
  onBeginChallenge: () => void;
  onToggleRealCamera: () => void;
  onSimulateOne: () => void;
  onPoseFrame: (frame: PoseFrame) => void;
  onCameraError: (message: string) => void;
  onCloseCompleted: () => void;
};

function AlarmChallengeModal({
  visible,
  snapshot,
  statusText,
  activeExerciseLabel,
  progressPercent,
  realCameraEnabled,
  busy,
  onBeginChallenge,
  onToggleRealCamera,
  onSimulateOne,
  onPoseFrame,
  onCameraError,
  onCloseCompleted,
}: AlarmChallengeModalProps) {
  const status = snapshot?.status ?? 'idle';
  const canClose = status === 'completed';
  const cameraFirstLayout = shouldUseCameraFirstChallengeLayout({ realCameraEnabled });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={canClose ? onCloseCompleted : noop}
    >
      <SafeAreaView style={styles.alarmModalShell}>
        <View style={styles.alarmModalHeader}>
          <Text style={styles.alarmModalBrand}>WakeFit</Text>
          <Text style={styles.alarmModalMeta}>{activeExerciseLabel} · {snapshot?.targetCount ?? 0} 次</Text>
        </View>

        {status === 'ringing' && (
          <View style={styles.alarmModalBody}>
            <Text style={styles.alarmRingLabel}>闹钟响铃</Text>
            <AlarmClock />
            <Text style={styles.alarmModalDetail}>完成 {snapshot?.targetCount ?? 0} 次{activeExerciseLabel}后才能关闭闹钟</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onBeginChallenge}
              style={({ pressed }) => [styles.alarmActionButton, pressed ? styles.alarmActionButtonPressed : null]}
            >
              <Text style={styles.alarmActionButtonText}>开始{activeExerciseLabel}</Text>
            </Pressable>
          </View>
        )}

        {status === 'challenge' && (
          <View style={[styles.alarmModalBody, styles.alarmChallengeBody, cameraFirstLayout ? styles.alarmCameraFirstBody : null]}>
            {cameraFirstLayout ? (
              <View style={styles.alarmCameraStage}>
                <NativePoseCameraView
                  style={styles.alarmCameraPreview}
                  cameraFacing="front"
                  onPoseFrame={onPoseFrame}
                  onCameraError={onCameraError}
                  fallback={
                    <View style={styles.cameraFallback}>
                      <Text style={styles.emptyTitle}>真实相机未加载</Text>
                      <Text style={styles.cameraFallbackText}>请使用 Android development build 测试 ML Kit 识别。</Text>
                    </View>
                  }
                />
                <View style={styles.alarmCameraCounter} pointerEvents="none">
                  <Text style={styles.alarmCameraCounterText}>{snapshot?.count ?? 0}/{snapshot?.targetCount ?? 0}</Text>
                  <Text style={styles.alarmCameraCounterLabel}>{activeExerciseLabel}</Text>
                </View>
                <View style={styles.alarmCameraHud}>
                  <View style={[styles.progressTrack, styles.alarmProgressTrack]}>
                    <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                  </View>
                  <View style={styles.buttonRow}>
                    <AppButton label="关闭相机" variant="secondary" onPress={onToggleRealCamera} disabled={busy} />
                    <AppButton label="模拟一次" onPress={onSimulateOne} disabled={busy} />
                  </View>
                  <Text style={styles.alarmModalStatus}>{statusText}</Text>
                </View>
              </View>
            ) : (
              <>
                <PosePreview progress={progressPercent} />
                <View style={styles.alarmProgressBlock}>
                  <Text style={styles.alarmProgressText}>{snapshot?.count ?? 0}/{snapshot?.targetCount ?? 0}</Text>
                  <Text style={styles.alarmModalDetail}>{activeExerciseLabel}</Text>
                </View>
                <View style={[styles.progressTrack, styles.alarmProgressTrack]}>
                  <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                </View>
                <View style={styles.buttonRow}>
                  <AppButton label="真实相机" variant="secondary" onPress={onToggleRealCamera} disabled={busy} />
                  <AppButton label="模拟一次" onPress={onSimulateOne} disabled={busy} />
                </View>
                <Text style={styles.alarmModalStatus}>{statusText}</Text>
              </>
            )}
          </View>
        )}

        {status === 'completed' && (
          <View style={styles.alarmModalBody}>
            <View style={styles.alarmCompleteBadge}>
              <Text style={styles.alarmCompleteBadgeText}>✓</Text>
            </View>
            <Text style={styles.alarmCompleteTitle}>闹钟已关闭</Text>
            <Text style={styles.alarmProgressText}>{snapshot?.count}/{snapshot?.targetCount}</Text>
            <Text style={styles.alarmModalDetail}>{statusText}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onCloseCompleted}
              style={({ pressed }) => [styles.alarmActionButton, styles.alarmCompleteButton, pressed ? styles.alarmActionButtonPressed : null]}
            >
              <Text style={styles.alarmActionButtonText}>回到首页</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function AlarmClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return <Text style={styles.alarmClockText}>{hours}:{minutes}</Text>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'gold' }) {
  return (
    <View style={[styles.metric, styles[`${tone}Metric`]]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.subtleText}>{detail}</Text>
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'blue' }) {
  return (
    <View style={[styles.statusPill, tone === 'green' ? styles.greenPill : styles.bluePill]}>
      <Text style={styles.statusPillText}>{label}</Text>
    </View>
  );
}

function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`${variant}Button`],
        pressed && !disabled ? styles.pressedButton : null,
        disabled ? styles.disabledButton : null,
      ]}
    >
      <Text style={[styles.buttonText, variant === 'primary' ? styles.primaryButtonText : styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.tabButton, active ? styles.activeTabButton : null]}>
      <Text style={[styles.tabButtonText, active ? styles.activeTabButtonText : null]}>{label}</Text>
    </Pressable>
  );
}

function ExerciseOption({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={[styles.exerciseOption, active ? styles.activeExerciseOption : null]}>
      <Text style={[styles.exerciseOptionText, active ? styles.activeExerciseOptionText : null]}>{label}</Text>
    </Pressable>
  );
}

function PosePreview({ progress }: { progress: number }) {
  return (
    <View style={styles.posePreview}>
      <View style={styles.poseHead} />
      <View style={styles.poseTorso} />
      <View style={styles.poseArmLeft} />
      <View style={styles.poseArmRight} />
      <View style={styles.poseFloor} />
      <Text style={styles.poseProgress}>{progress}%</Text>
    </View>
  );
}

function toApiAlarm(input: LocalAlarmConfig): ApiAlarm {
  return {
    id: input.serverId,
    localAlarmId: input.id,
    timeOfDay: input.timeOfDay,
    timezone: input.timezone,
    enabled: input.enabled,
    targetCount: input.targetCount,
    exerciseType: input.exerciseType,
  };
}

function normalizeBackendUrl(input: string) {
  return input.trim().replace(/\/+$/, '');
}

function normalizeTimeOfDay(input: string, fallback: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) {
    return fallback;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour > 23 || minute > 59) {
    return fallback;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getNextFireAt(timeOfDay: string) {
  const [hour, minute] = timeOfDay.split(':').map((item) => Number.parseInt(item, 10));
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function formatNextFireAt(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function getTodayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getCurrentMonthKey() {
  return getTodayLocalDate().slice(0, 7);
}

function getLocalTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
}

function getExerciseLabel(exerciseType: ExerciseType) {
  return exerciseType === 'squat' ? '深蹲' : '俯卧撑';
}

async function requestCameraPermission() {
  if (Platform.OS === 'ios') {
    return true;
  }

  if (Platform.OS !== 'android') {
    return false;
  }

  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

async function requestAlarmNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return true;
  }

  const permission = 'android.permission.POST_NOTIFICATIONS' as typeof PermissionsAndroid.PERMISSIONS.CAMERA;
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function mergeWorkout(workout: CalendarWorkout, items: CalendarWorkout[]) {
  const merged = [workout, ...items.filter((item) => item.workoutDate !== workout.workoutDate || item.alarmId !== workout.alarmId)];
  return merged.sort((a, b) => b.workoutDate.localeCompare(a.workoutDate));
}

function updateLocalStreak(current: StreakSummary, workoutDate: string): StreakSummary {
  if (current.lastCompletedDate === workoutDate) {
    return current;
  }

  const nextCurrent = current.lastCompletedDate && isPreviousDate(current.lastCompletedDate, workoutDate)
    ? current.currentDays + 1
    : 1;

  return {
    currentDays: nextCurrent,
    longestDays: Math.max(current.longestDays, nextCurrent),
    lastCompletedDate: workoutDate,
  };
}

function isPreviousDate(previous: string, next: string) {
  const previousDate = new Date(`${previous}T00:00:00`);
  previousDate.setDate(previousDate.getDate() + 1);
  const expected = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;
  return expected === next;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function noop() {
  // Intentionally empty.
}

const palette = {
  bg: '#0b0e14',
  card: '#141a24',
  cardAlt: '#1b2331',
  border: '#26303f',
  text: '#f2f5fa',
  muted: '#8b95a8',
  accent: '#e5484d',
  accentDark: '#b93a3e',
  green: '#3fb68b',
  gold: '#f0a33c',
  blue: '#5b8def',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  appShell: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: palette.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerMeta: {
    color: palette.muted,
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  metric: {
    flex: 1,
    minHeight: 86,
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
    borderWidth: 1,
    backgroundColor: palette.card,
    borderColor: palette.border,
  },
  greenMetric: {
    borderTopColor: palette.green,
    borderTopWidth: 3,
  },
  blueMetric: {
    borderTopColor: palette.blue,
    borderTopWidth: 3,
  },
  goldMetric: {
    borderTopColor: palette.gold,
    borderTopWidth: 3,
  },
  metricLabel: {
    color: palette.muted,
    fontSize: 12,
  },
  metricValue: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '800',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 1,
  },
  sectionBody: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
  },
  alarmSummary: {
    minHeight: 96,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  clockText: {
    color: palette.text,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 1,
  },
  subtleText: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  challengePanel: {
    gap: 14,
  },
  ringingTitle: {
    color: palette.accent,
    fontSize: 30,
    fontWeight: '900',
  },
  completedTitle: {
    color: palette.green,
    fontSize: 30,
    fontWeight: '900',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  progressText: {
    color: palette.text,
    fontSize: 36,
    fontWeight: '900',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.cardAlt,
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.accent,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  button: {
    minHeight: 46,
    minWidth: 96,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primaryButton: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  secondaryButton: {
    backgroundColor: palette.cardAlt,
    borderColor: palette.border,
  },
  quietButton: {
    backgroundColor: 'transparent',
    borderColor: palette.border,
  },
  pressedButton: {
    opacity: 0.75,
  },
  disabledButton: {
    opacity: 0.45,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButtonText: {
    color: '#ffffff',
  },
  secondaryButtonText: {
    color: palette.text,
  },
  field: {
    gap: 8,
    marginBottom: 16,
  },
  fieldLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.cardAlt,
    borderRadius: 14,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 14,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperInput: {
    flex: 1,
    textAlign: 'center',
  },
  switchRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  exerciseOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  exerciseOption: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  activeExerciseOption: {
    borderColor: palette.accent,
    backgroundColor: 'rgba(229, 72, 77, 0.16)',
  },
  exerciseOptionText: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  activeExerciseOptionText: {
    color: palette.text,
  },
  statusText: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  emptyState: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '800',
  },
  workoutRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    gap: 12,
  },
  workoutDate: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '800',
  },
  workoutCount: {
    color: palette.green,
    fontSize: 20,
    fontWeight: '900',
  },
  statusPill: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  greenPill: {
    backgroundColor: 'rgba(63, 182, 139, 0.14)',
    borderColor: 'rgba(63, 182, 139, 0.45)',
  },
  bluePill: {
    backgroundColor: 'rgba(91, 141, 239, 0.14)',
    borderColor: 'rgba(91, 141, 239, 0.45)',
  },
  statusPillText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '800',
  },
  posePreview: {
    height: 180,
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#0e131c',
    overflow: 'hidden',
    position: 'relative',
  },
  cameraPreview: {
    height: 340,
    borderRadius: 16,
    backgroundColor: '#0e131c',
    overflow: 'hidden',
  },
  cameraFallback: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    backgroundColor: '#0e131c',
  },
  cameraFallbackText: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  poseHead: {
    position: 'absolute',
    top: 30,
    left: '50%',
    width: 26,
    height: 26,
    marginLeft: -13,
    borderRadius: 13,
    backgroundColor: '#f2f5fa',
  },
  poseTorso: {
    position: 'absolute',
    top: 60,
    left: '50%',
    width: 8,
    height: 56,
    marginLeft: -4,
    borderRadius: 4,
    backgroundColor: '#f2f5fa',
  },
  poseArmLeft: {
    position: 'absolute',
    top: 74,
    left: '50%',
    width: 72,
    height: 7,
    marginLeft: -78,
    borderRadius: 4,
    backgroundColor: palette.blue,
    transform: [{ rotate: '-16deg' }],
  },
  poseArmRight: {
    position: 'absolute',
    top: 74,
    left: '50%',
    width: 72,
    height: 7,
    marginLeft: 6,
    borderRadius: 4,
    backgroundColor: palette.blue,
    transform: [{ rotate: '16deg' }],
  },
  poseFloor: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 30,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.border,
  },
  poseProgress: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    color: palette.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  tabs: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    minHeight: 62,
    borderRadius: 999,
    backgroundColor: 'rgba(20, 26, 36, 0.96)',
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: 'row',
    padding: 6,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  activeTabButton: {
    backgroundColor: palette.accent,
  },
  tabButtonText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  activeTabButtonText: {
    color: '#ffffff',
  },
  alarmModalShell: {
    flex: 1,
    backgroundColor: '#07090d',
    paddingHorizontal: 16,
  },
  alarmModalHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  alarmModalBrand: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  alarmModalMeta: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  alarmModalBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingBottom: 40,
  },
  alarmChallengeBody: {
    justifyContent: 'flex-start',
    gap: 14,
    paddingTop: 4,
  },
  alarmCameraFirstBody: {
    paddingBottom: 12,
  },
  alarmRingLabel: {
    color: palette.muted,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 4,
  },
  alarmClockText: {
    color: palette.text,
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  alarmActionButton: {
    minWidth: 220,
    minHeight: 58,
    borderRadius: 999,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  alarmCompleteButton: {
    backgroundColor: palette.green,
  },
  alarmActionButtonPressed: {
    opacity: 0.8,
  },
  alarmActionButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  alarmModalDetail: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  alarmModalStatus: {
    width: '100%',
    maxWidth: 420,
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  alarmProgressBlock: {
    alignItems: 'center',
    gap: 2,
  },
  alarmProgressText: {
    color: palette.text,
    fontSize: 56,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  alarmProgressTrack: {
    width: '100%',
  },
  alarmCameraStage: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    position: 'relative',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0e131c',
  },
  alarmCameraPreview: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    backgroundColor: '#0e131c',
  },
  alarmCameraCounter: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
  },
  alarmCameraCounterText: {
    color: '#ffffff',
    fontSize: 52,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  alarmCameraCounterLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  alarmCameraHud: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(7, 9, 13, 0.72)',
  },
  alarmCompleteBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(63, 182, 139, 0.16)',
    borderWidth: 2,
    borderColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmCompleteBadgeText: {
    color: palette.green,
    fontSize: 56,
    fontWeight: '900',
  },
  alarmCompleteTitle: {
    color: palette.green,
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
  },
});
