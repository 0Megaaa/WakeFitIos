import React from 'react';
import { Text, View } from 'react-native';

import type { WakeFitControllerState, WakeFitControllerActions } from '../hooks/useWakeFitController.ts';
import {
  AppButton,
  EmptyState,
  Metric,
  Section,
} from '../components/index.ts';
import { NativePoseCameraView } from '../../platform/camera/NativePoseCameraView.tsx';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';
import { PosePreview } from '../components/PosePreview.tsx';
import { shouldRenderInlineCamera } from '../camera/index.ts';
import { getExerciseLabel } from './exerciseLabel.ts';
import { formatNextFireAtValue } from '../hooks/useWakeFitController.ts';

export type HomeTabProps = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
  isDebugToolsEnabled: boolean;
};

export function HomeTab({ state, actions, isDebugToolsEnabled }: HomeTabProps) {
  const challengeStatus = state.snapshot?.status ?? 'idle';
  const activeExerciseLabel = getExerciseLabel(state.snapshot?.exerciseType ?? state.alarm.exerciseType);
  const progressPercent = state.snapshot
    ? Math.min(100, Math.round((state.snapshot.count / state.snapshot.targetCount) * 100))
    : 0;
  const alarmModalVisible = state.flow !== null && challengeStatus !== 'idle';
  const inlineCameraVisible = shouldRenderInlineCamera({ realCameraEnabled: state.realCameraEnabled, alarmModalVisible });

  return (
    <>
      <View style={wakeFitStyles.metricsGrid}>
        <Metric label="连续" value={`${state.streak.currentDays} 天`} tone="green" />
        <Metric label="最长" value={`${state.streak.longestDays} 天`} tone="blue" />
        <Metric label="队列" value={`${state.queuedCount} 条`} tone="gold" />
      </View>

      <Section title="今日闹钟">
        <View style={wakeFitStyles.alarmSummary}>
          <View>
            <Text style={wakeFitStyles.clockText}>{state.alarm.timeOfDay}</Text>
            <Text style={wakeFitStyles.subtleText}>
              {state.alarm.enabled ? '已开启' : '已关闭'} · {state.alarm.targetCount} 次{getExerciseLabel(state.alarm.exerciseType)}
            </Text>
            <Text style={wakeFitStyles.subtleText}>
              {state.alarm.enabled && state.nextFireAt ? `下次响铃 ${formatNextFireAtValue(state.nextFireAt)}` : '闹钟未排程'}
            </Text>
          </View>
          <AppButton label="立即测试" onPress={actions.startRingingNow} />
        </View>
      </Section>

      <Section title="挑战">
        {challengeStatus === 'idle' && (
          <EmptyState title="等待响铃" detail="点击立即测试可进入完整挑战流程。" />
        )}

        {challengeStatus === 'ringing' && (
          <View style={wakeFitStyles.challengePanel}>
            <Text style={wakeFitStyles.ringingTitle}>闹钟响铃</Text>
            <Text style={wakeFitStyles.subtleText}>目标 {state.snapshot?.targetCount} 次，完成后结束。</Text>
            <View style={wakeFitStyles.buttonRow}>
              <AppButton label="开始挑战" onPress={actions.beginChallenge} />
              <AppButton label="重置" variant="secondary" onPress={actions.resetChallenge} />
            </View>
          </View>
        )}

        {challengeStatus === 'challenge' && (
          <View style={wakeFitStyles.challengePanel}>
            {inlineCameraVisible ? (
              <NativePoseCameraView
                style={wakeFitStyles.cameraPreview}
                cameraFacing="front"
                onPoseFrame={actions.handleRealPoseFrame}
                onCameraError={actions.handleCameraError}
                fallback={
                  <View style={wakeFitStyles.cameraFallback}>
                    <Text style={wakeFitStyles.emptyTitle}>真实相机未加载</Text>
                    <Text style={wakeFitStyles.subtleText}>请使用 iOS 或 Android development build 测试真实姿态识别。</Text>
                  </View>
                }
              />
            ) : (
              <PosePreview progress={progressPercent} />
            )}
            <View style={wakeFitStyles.progressHeader}>
              <Text style={wakeFitStyles.progressText}>{state.snapshot?.count ?? 0}/{state.snapshot?.targetCount ?? state.alarm.targetCount}</Text>
              <Text style={wakeFitStyles.subtleText}>{activeExerciseLabel}</Text>
            </View>
            <View style={wakeFitStyles.progressTrack}>
              <View style={[wakeFitStyles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
            <View style={wakeFitStyles.buttonRow}>
              <AppButton label={state.realCameraEnabled ? '关闭相机' : '真实相机'} variant="secondary" onPress={actions.toggleRealCamera} disabled={state.busy} />
              {isDebugToolsEnabled && (
                <AppButton label="模拟一次" onPress={actions.simulateOnePushUp} disabled={state.busy} />
              )}
              <AppButton label="重置" variant="secondary" onPress={actions.resetChallenge} />
            </View>
          </View>
        )}

        {challengeStatus === 'completed' && (
          <View style={wakeFitStyles.challengePanel}>
            <Text style={wakeFitStyles.completedTitle}>挑战完成</Text>
            <Text style={wakeFitStyles.progressText}>{state.snapshot?.count}/{state.snapshot?.targetCount}</Text>
            <Text style={wakeFitStyles.subtleText}>{state.snapshot?.workout?.workoutDate} · {state.status}</Text>
            <View style={wakeFitStyles.buttonRow}>
              <AppButton label="再测一次" onPress={actions.startRingingNow} />
              <AppButton label="查看记录" variant="secondary" onPress={() => actions.setTab('history')} />
            </View>
          </View>
        )}
      </Section>

      <Text style={wakeFitStyles.statusText}>{state.status}</Text>
    </>
  );
}