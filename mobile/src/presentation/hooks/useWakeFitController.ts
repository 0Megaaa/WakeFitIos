import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { WakeFitDependencies } from '../../app/types.ts';
import type { ExerciseType, LocalAlarmConfig } from '../../domain/alarm/alarm.ts';
import {
  createAlarmConfig,
  normalizeTargetCount,
  updateAlarmConfig,
} from '../../domain/alarm/alarm.ts';
import type { ChallengeFlowOptions, ChallengeSnapshot } from '../../domain/challenge/types.ts';
import { createChallengeFlow } from '../../domain/challenge/challengeFlow.ts';

type ChallengeFlow = ReturnType<typeof createChallengeFlow>;
import { driveOneSimulatedExercise } from '../../debug/simulation/demoChallenge.ts';
import {
  cancelAlarm,
  consumePendingAlarmLaunch,
  flushWorkoutQueue,
  recordCompletedWorkout,
  scheduleAlarm,
  startChallenge,
} from '../../application/usecases/index.ts';
import type {
  ApiAlarm,
  ApiWorkoutUpload,
  CalendarWorkout,
  StreakSummary,
  WakeFitApiClient,
  WorkoutSyncQueue,
} from '../../application/ports/index.ts';
import type { PoseFrame } from '../../domain/exercise/types.ts';
import { evaluatePoseQuality } from '../../domain/exercise/index.ts';

let lastPoseQualityIssue: string = 'ok';

export type ControllerTab = 'home' | 'alarm' | 'history' | 'backend';

export type WakeFitControllerState = {
  tab: ControllerTab;
  alarm: LocalAlarmConfig;
  timeDraft: string;
  targetDraft: string;
  exerciseDraft: ExerciseType;
  alarmEnabled: boolean;
  flow: ChallengeFlow | null;
  snapshot: ChallengeSnapshot | null;
  streak: StreakSummary;
  workouts: CalendarWorkout[];
  backendEnabled: boolean;
  backendUrl: string;
  token: string | null;
  queuedCount: number;
  status: string;
  busy: boolean;
  realCameraEnabled: boolean;
  cameraFacing: 'front' | 'back';
  poseQualityIssue: 'ok' | 'partial_body' | 'low_confidence' | 'out_of_frame' | 'too_close' | 'too_far';
  poseGuidance: string;
  nextFireAt: string | null;
};

export type WakeFitControllerDebugState = {
  poseQualityIssue: 'ok' | 'partial_body' | 'low_confidence' | 'out_of_frame' | 'too_close' | 'too_far';
  poseGuidance: string;
  kneeAngle: number | null;
  hipAngle: number | null;
  bodyFillRatio: number | null;
  visibleLandmarkCount: number;
  requiredLandmarkCount: number;
};

export type WakeFitControllerActions = {
  setTab: (tab: ControllerTab) => void;
  setTimeDraft: (value: string) => void;
  setTargetDraft: (value: string) => void;
  setExerciseDraft: (value: ExerciseType) => void;
  setAlarmEnabled: (value: boolean) => void;
  setBackendEnabled: (value: boolean) => void;
  setBackendUrl: (value: string) => void;
  saveAlarm: () => Promise<void>;
  startRingingNow: () => void;
  beginChallenge: () => void;
  simulateOnePushUp: () => void;
  toggleRealCamera: () => Promise<void>;
  toggleCameraFacing: () => void;
  handleRealPoseFrame: (frame: PoseFrame) => void;
  handleCameraError: (message: string) => void;
  resetChallenge: () => void;
  closeCompletedAlarm: () => void;
  loginBackend: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  flushQueue: () => Promise<void>;
};

export type WakeFitControllerDebug = {
  isDebugToolsEnabled: boolean;
};

export type WakeFitControllerResult = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
  debug: WakeFitControllerDebug;
};

const DEFAULT_ALARM_TIME = '07:30';
const DEFAULT_TARGET_COUNT = 5;
const DEFAULT_EXERCISE: ExerciseType = 'squat';
const DEFAULT_STATUS = '本地模式已就绪';
const INITIAL_STREAK: StreakSummary = {
  currentDays: 0,
  longestDays: 0,
  lastCompletedDate: null,
};

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

function getTodayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getCurrentMonthKey(): string {
  return getTodayLocalDate().slice(0, 7);
}

function normalizeBackendUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function normalizeTimeOfDay(input: string, fallback: string): string {
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

function getNextFireAt(timeOfDay: string): string {
  const [hour, minute] = timeOfDay.split(':').map((item) => Number.parseInt(item, 10));
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function formatNextFireAt(value: string): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function mergeWorkout(workout: CalendarWorkout, items: CalendarWorkout[]): CalendarWorkout[] {
  const merged = [
    workout,
    ...items.filter((item) => item.workoutDate !== workout.workoutDate || item.alarmId !== workout.alarmId),
  ];
  return merged.sort((a, b) => b.workoutDate.localeCompare(a.workoutDate));
}

function isPreviousDate(previous: string, next: string): boolean {
  const previousDate = new Date(`${previous}T00:00:00`);
  previousDate.setDate(previousDate.getDate() + 1);
  const expected = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;
  return expected === next;
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

export function formatNextFireAtValue(value: string): string {
  return formatNextFireAt(value);
}

export function buildLocalStreak(current: StreakSummary, workoutDate: string): StreakSummary {
  return updateLocalStreak(current, workoutDate);
}

export function mergeWorkoutList(workout: CalendarWorkout, items: CalendarWorkout[]): CalendarWorkout[] {
  return mergeWorkout(workout, items);
}

export function normalizeTimeOfDayInput(input: string, fallback: string): string {
  return normalizeTimeOfDay(input, fallback);
}

export function computeNextFireAt(timeOfDay: string): string {
  return getNextFireAt(timeOfDay);
}

export function useWakeFitController(dependencies: WakeFitDependencies, isDebugToolsEnabled = false): WakeFitControllerResult {
  const {
    deviceId,
    createApiClient,
    createSyncQueue,
    platform,
  } = dependencies;

  const tokenRef = useRef<string | null>(null);
  const recordedWorkoutIDs = useRef(new Set<string>());
  const consumedAlarmLaunches = useRef(new Set<string>());
  const handledAlarmFireKeys = useRef(new Set<string>());
  const alarmRef = useRef<LocalAlarmConfig | null>(null);

  const [tab, setTab] = useState<ControllerTab>('home');
  const [alarm, setAlarm] = useState<LocalAlarmConfig>(() =>
    createAlarmConfig({
      id: 'alarm-demo-1',
      label: '晨间训练',
      timeOfDay: DEFAULT_ALARM_TIME,
      targetCount: DEFAULT_TARGET_COUNT,
      exerciseType: DEFAULT_EXERCISE,
      timezone: getLocalTimezone(),
    }),
  );
  const [timeDraft, setTimeDraft] = useState(DEFAULT_ALARM_TIME);
  const [targetDraft, setTargetDraft] = useState(String(DEFAULT_TARGET_COUNT));
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseType>(DEFAULT_EXERCISE);
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [flow, setFlow] = useState<ChallengeFlow | null>(null);
  const [snapshot, setSnapshot] = useState<ChallengeSnapshot | null>(null);
  const [streak, setStreak] = useState<StreakSummary>(INITIAL_STREAK);
  const [workouts, setWorkouts] = useState<CalendarWorkout[]>([]);
  const [backendEnabled, setBackendEnabled] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [busy, setBusy] = useState(false);
  const [realCameraEnabled, setRealCameraEnabled] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [poseQualityIssue, setPoseQualityIssue] = useState<'ok' | 'partial_body' | 'low_confidence' | 'out_of_frame' | 'too_close' | 'too_far'>('ok');
  const [poseGuidance, setPoseGuidance] = useState('');
  const [nextFireAt, setNextFireAt] = useState<string | null>(null);

  alarmRef.current = alarm;

  // Recreate API Client when backendUrl changes - no stale caching.
  const apiClient = useMemo<WakeFitApiClient>(() => {
    return createApiClient({
      baseUrl: normalizeBackendUrl(backendUrl) || 'http://127.0.0.1:8080',
      getAuthToken: () => tokenRef.current,
    });
  }, [backendUrl, createApiClient]);

  // Recreate Sync Queue when apiClient changes.
  const syncQueue = useMemo<WorkoutSyncQueue>(() => {
    return createSyncQueue(apiClient);
  }, [apiClient, createSyncQueue]);

  const startAlarmFlow = useCallback(
    (input: LocalAlarmConfig, fireAt = new Date().toISOString(), dedupeScheduledFire = true) => {
      const firedAtMillis = Date.parse(fireAt);
      if (dedupeScheduledFire && !Number.isNaN(firedAtMillis)) {
        const fireKey = `${input.id}:${Math.floor(firedAtMillis / 60_000)}`;
        if (handledAlarmFireKeys.current.has(fireKey)) {
          return;
        }
        handledAlarmFireKeys.current.add(fireKey);
      }

      const nextFlow = startChallenge({
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
    },
    [],
  );

  const ensureGuestSession = useCallback(async () => {
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
  }, [apiClient, backendUrl, deviceId]);

  const syncAlarmWithBackend = useCallback(async (input: LocalAlarmConfig): Promise<LocalAlarmConfig> => {
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
  }, [apiClient, ensureGuestSession]);

  const recordCompletedWorkoutHandler = useCallback(async (workout: ApiWorkoutUpload) => {
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
        // Queue still records the workout if the backend is unreachable.
      }
      const result = await recordCompletedWorkout({ syncQueue, workout });
      setQueuedCount(result.queuedCount);
      setStatus(
        result.uploaded
          ? `训练已上传，后端记录 #${result.uploadResult?.id}`
          : `后端不可用，已加入上传队列 ${result.queuedCount} 条`,
      );
    } finally {
      setBusy(false);
    }
  }, [backendEnabled, ensureGuestSession, syncQueue]);

  const consumePendingNativeAlarm = useCallback(async () => {
    const launch = await consumePendingAlarmLaunch({ service: platform.pendingAlarmLaunchService });
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
        timeOfDay: launch.timeOfDay || normalizeTimeOfDay(launch.firedAt.slice(11, 16), DEFAULT_ALARM_TIME),
        targetCount: normalizeTargetCount(launch.targetCount),
        exerciseType: launch.exerciseType ?? DEFAULT_EXERCISE,
        timezone: getLocalTimezone(),
      });

    startAlarmFlow(launchAlarm, launch.firedAt);
  }, [platform.pendingAlarmLaunchService, startAlarmFlow]);

  useEffect(() => {
    void consumePendingNativeAlarm();
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void consumePendingNativeAlarm();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [consumePendingNativeAlarm]);

  useEffect(() => {
    const unsubscribe = platform.foregroundAlarmEvents.subscribe((event) => {
      const currentAlarm = alarmRef.current;
      if (!currentAlarm || !currentAlarm.enabled || currentAlarm.id !== event.alarmId) {
        return;
      }
      const nextFire = getNextFireAt(currentAlarm.timeOfDay);
      setNextFireAt(nextFire);
      startAlarmFlow(currentAlarm, event.firedAt);
      void scheduleAlarm({
        scheduler: platform.alarmScheduler,
        alarmId: currentAlarm.id,
        fireAt: nextFire,
        label: currentAlarm.label,
        timeOfDay: currentAlarm.timeOfDay,
        targetCount: currentAlarm.targetCount,
        exerciseType: currentAlarm.exerciseType,
      });
    });
    return unsubscribe;
  }, [platform.alarmScheduler, platform.foregroundAlarmEvents, startAlarmFlow]);

  useEffect(() => {
    const status = snapshot?.status ?? 'idle';
    if (status === 'ringing' || status === 'challenge') {
      void platform.alarmAlertService.start();
      return;
    }
    void platform.alarmAlertService.stop();
  }, [platform.alarmAlertService, snapshot?.status]);

  useEffect(() => {
    return () => {
      void platform.alarmAlertService.stop();
    };
  }, [platform.alarmAlertService]);

  useEffect(() => {
    if (!alarm.enabled) {
      setNextFireAt(null);
      void cancelAlarm({ scheduler: platform.alarmScheduler, alarmId: alarm.id });
      return;
    }

    const nextFire = getNextFireAt(alarm.timeOfDay);
    setNextFireAt(nextFire);
    void scheduleAlarm({
      scheduler: platform.alarmScheduler,
      alarmId: alarm.id,
      fireAt: nextFire,
      label: alarm.label,
      timeOfDay: alarm.timeOfDay,
      targetCount: alarm.targetCount,
      exerciseType: alarm.exerciseType,
    });

    return () => {
      void cancelAlarm({ scheduler: platform.alarmScheduler, alarmId: alarm.id });
    };
  }, [alarm.enabled, alarm.exerciseType, alarm.id, alarm.label, alarm.targetCount, alarm.timeOfDay, platform.alarmScheduler]);

  const saveAlarm = useCallback(async () => {
    setBusy(true);
    try {
      const nextAlarm = updateAlarmConfig(alarm, {
        timeOfDay: normalizeTimeOfDay(timeDraft, alarm.timeOfDay),
        enabled: alarmEnabled,
        exerciseType: exerciseDraft,
        targetCount: Number.parseInt(targetDraft, 10),
      });

      if (nextAlarm.enabled) {
        await platform.permissionService.requestNotificationPermission();
      }

      setAlarm(nextAlarm);
      setTimeDraft(nextAlarm.timeOfDay);
      setTargetDraft(String(nextAlarm.targetCount));

      if (backendEnabled) {
        const syncedAlarm = await syncAlarmWithBackend(nextAlarm);
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
  }, [alarm, alarmEnabled, backendEnabled, exerciseDraft, platform.permissionService, syncAlarmWithBackend, targetDraft, timeDraft]);

  const startRingingNow = useCallback(() => {
    startAlarmFlow(alarm, new Date().toISOString(), false);
  }, [alarm, startAlarmFlow]);

  const beginChallenge = useCallback(() => {
    if (!flow) {
      return;
    }
    setSnapshot(flow.beginChallenge());
    setStatus('挑战已开始');
  }, [flow]);

  const simulateOnePushUp = useCallback(() => {
    if (!flow || snapshot?.status !== 'challenge') {
      return;
    }

    const nextSnapshot = driveOneSimulatedExercise(flow, snapshot.exerciseType);
    setSnapshot(nextSnapshot);

    if (nextSnapshot.status === 'completed' && nextSnapshot.workout) {
      void recordCompletedWorkoutHandler(nextSnapshot.workout);
    }
  }, [flow, recordCompletedWorkoutHandler, snapshot?.exerciseType, snapshot?.status]);

  const toggleRealCamera = useCallback(async () => {
    if (realCameraEnabled) {
      setRealCameraEnabled(false);
      setStatus('真实相机已关闭');
      return;
    }

    if (!platform.poseCamera.supported) {
      setStatus('请使用 iOS 或 Android development build 测试真实姿态识别');
      return;
    }

    const permissionStatus = await platform.permissionService.requestCameraPermission();
    if (permissionStatus !== 'granted') {
      setStatus('没有摄像头权限，无法开启真实识别');
      return;
    }

    setRealCameraEnabled(true);
    setStatus('真实相机识别已开启');
  }, [platform.permissionService, platform.poseCamera.supported, realCameraEnabled]);

  const toggleCameraFacing = useCallback(() => {
    setCameraFacing((prev) => {
      const next = prev === 'front' ? 'back' : 'front';
      setStatus(next === 'back' ? '已切换至后置摄像头' : '已切换至前置摄像头');
      return next;
    });
  }, []);

  const handleRealPoseFrame = useCallback((frame: PoseFrame) => {
    if (!flow) {
      return;
    }

    const currentSnapshot = flow.getSnapshot();
    if (currentSnapshot.status !== 'challenge') {
      return;
    }

    // Evaluate pose quality first - do not count if quality is not ok
    const quality = evaluatePoseQuality(frame, { exerciseType: currentSnapshot.exerciseType });

    if (quality.issue !== lastPoseQualityIssue) {
      lastPoseQualityIssue = quality.issue;
      setPoseQualityIssue(quality.issue);
      setPoseGuidance(quality.guidance);
    }

    // Only process the frame if quality is ok
    if (quality.issue !== 'ok') {
      return;
    }

    const nextSnapshot = flow.handlePoseFrame(frame);
    setSnapshot(nextSnapshot);

    if (nextSnapshot.status === 'completed' && nextSnapshot.workout) {
      void recordCompletedWorkoutHandler(nextSnapshot.workout);
    }
  }, [flow, recordCompletedWorkoutHandler]);

  const handleCameraError = useCallback((message: string) => {
    setStatus(`真实识别错误：${message}`);
  }, []);

  const resetChallenge = useCallback(() => {
    flow?.reset();
    setFlow(null);
    setSnapshot(null);
    setRealCameraEnabled(false);
    setStatus('挑战已重置');
  }, [flow]);

  const closeCompletedAlarm = useCallback(() => {
    if (snapshot?.status !== 'completed') {
      return;
    }

    setFlow(null);
    setSnapshot(null);
    setRealCameraEnabled(false);
    setStatus('闹钟已关闭，训练已完成');
  }, [snapshot?.status]);

  const loginBackend = useCallback(async () => {
    setBusy(true);
    try {
      await ensureGuestSession();
      setStatus('访客登录成功');
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [ensureGuestSession]);

  const refreshDashboard = useCallback(async () => {
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
  }, [apiClient, ensureGuestSession]);

  const flushQueue = useCallback(async () => {
    setBusy(true);
    try {
      try {
        await ensureGuestSession();
      } catch {
        // Flush will report remaining items if upload still cannot complete.
      }
      const result = await flushWorkoutQueue({ syncQueue });
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
  }, [ensureGuestSession, refreshDashboard, syncQueue]);

  // Clear token when backendUrl changes so old token is never sent to a new server.
  useEffect(() => {
    tokenRef.current = null;
    setToken(null);
  }, [backendUrl]);

  const state: WakeFitControllerState = {
    tab,
    alarm,
    timeDraft,
    targetDraft,
    exerciseDraft,
    alarmEnabled,
    flow,
    snapshot,
    streak,
    workouts,
    backendEnabled,
    backendUrl,
    token,
    queuedCount,
    status,
    busy,
    realCameraEnabled,
    cameraFacing,
    poseQualityIssue,
    poseGuidance,
    nextFireAt,
  };

  const actions: WakeFitControllerActions = {
    setTab,
    setTimeDraft,
    setTargetDraft,
    setExerciseDraft,
    setAlarmEnabled,
    setBackendEnabled,
    setBackendUrl,
    saveAlarm,
    startRingingNow,
    beginChallenge,
    simulateOnePushUp,
    toggleRealCamera,
    toggleCameraFacing,
    handleRealPoseFrame,
    handleCameraError,
    resetChallenge,
    closeCompletedAlarm,
    loginBackend,
    refreshDashboard,
    flushQueue,
  };

  const debug: WakeFitControllerDebug = {
    isDebugToolsEnabled,
  };

  return { state, actions, debug };
}
