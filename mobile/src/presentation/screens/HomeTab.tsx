import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

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

// Platform-safe ad imports
import { WakeFitAdView } from '../../platform/ads/WakeFitAdView.tsx';
import { WakeFitAds } from '../../platform/ads/WakeFitAds.ts';

export type HomeTabProps = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
  isDebugToolsEnabled: boolean;
};

// Suppression condition: challenge modal active or pending alarm check not complete
function shouldSuppressAds(state: WakeFitControllerState): boolean {
  const challengeActive = state.flow !== null && state.snapshot?.status !== 'idle';
  const pendingAlarmNotChecked = !state.initialPendingAlarmCheckComplete;
  return challengeActive || pendingAlarmNotChecked;
}

export function HomeTab({ state, actions, isDebugToolsEnabled }: HomeTabProps) {
  const challengeStatus = state.snapshot?.status ?? 'idle';
  const activeExerciseLabel = getExerciseLabel(state.snapshot?.exerciseType ?? state.alarm.exerciseType);
  const progressPercent = state.snapshot
    ? Math.min(100, Math.round((state.snapshot.count / state.snapshot.targetCount) * 100))
    : 0;
  const alarmModalVisible = state.flow !== null && challengeStatus !== 'idle';
  const inlineCameraVisible = shouldRenderInlineCamera({ realCameraEnabled: state.realCameraEnabled, alarmModalVisible });

  // Ad suppression state
  const [adsSuppressed, setAdsSuppressed] = useState(false);

  // Rewarded button state
  const [rewardCooldown, setRewardCooldown] = useState(0);

  // Update suppression when challenge state changes
  useEffect(() => {
    const suppress = shouldSuppressAds(state);
    setAdsSuppressed(suppress);
    void WakeFitAds.setSuppressed(suppress);
  }, [state.flow, state.snapshot?.status, state.initialPendingAlarmCheckComplete]);

  // Start interstitial loop on mount, stop on unmount
  useEffect(() => {
    void WakeFitAds.startInterstitialLoop('home_timed');
    return () => {
      void WakeFitAds.stopInterstitialLoop();
    };
  }, []);

  // Poll reward cooldown
  useEffect(() => {
    const interval = setInterval(async () => {
      const remaining = await WakeFitAds.getRewardCooldownRemaining();
      setRewardCooldown(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRewardedPress = useCallback(async () => {
    if (rewardCooldown > 0) return;
    const success = await WakeFitAds.showRewarded('home_rewarded');
    if (success) {
      setRewardCooldown(await WakeFitAds.getRewardCooldownRemaining());
    }
  }, [rewardCooldown]);

  return (
    <>
      <View style={wakeFitStyles.metricsGrid}>
        <Metric label="连续" value={`${state.streak.currentDays} 天`} tone="green" />
        <Metric label="最长" value={`${state.streak.longestDays} 天`} tone="blue" />
        <Metric label="队列" value={`${state.queuedCount} 条`} tone="gold" />
      </View>

      {/* Banner Ad */}
      {Platform.OS === 'ios' && (
        <Section title="广告">
          <View style={wakeFitStyles.bannerAdContainer}>
            <WakeFitAdView
              format="banner"
              sceneID="home_banner"
              style={wakeFitStyles.bannerAd}
            />
          </View>
        </Section>
      )}

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

      {/* Native Ad */}
      {Platform.OS === 'ios' && (
        <Section title="推荐">
          <View style={wakeFitStyles.nativeAdContainer}>
            <WakeFitAdView
              format="native"
              sceneID="home_native"
              style={wakeFitStyles.nativeAd}
            />
          </View>
        </Section>
      )}

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
                cameraFacing={state.cameraFacing}
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
            {state.poseGuidance ? (
              <Text style={wakeFitStyles.poseGuidanceText}>{state.poseGuidance}</Text>
            ) : null}
            <View style={wakeFitStyles.progressHeader}>
              <Text style={wakeFitStyles.progressText}>{state.snapshot?.count ?? 0}/{state.snapshot?.targetCount ?? state.alarm.targetCount}</Text>
              <Text style={wakeFitStyles.subtleText}>{activeExerciseLabel}</Text>
            </View>
            <View style={wakeFitStyles.progressTrack}>
              <View style={[wakeFitStyles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
            <View style={wakeFitStyles.buttonRow}>
              <AppButton label={state.realCameraEnabled ? '关闭相机' : '真实相机'} variant="secondary" onPress={actions.toggleRealCamera} disabled={state.busy} />
              {state.realCameraEnabled && (
                <AppButton label={state.cameraFacing === 'front' ? '后置' : '前置'} variant="secondary" onPress={actions.toggleCameraFacing} disabled={state.busy} />
              )}
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

      {/* Rewarded Ad Section */}
      {Platform.OS === 'ios' && (
        <Section title="支持 WakeFit">
          <View style={wakeFitStyles.rewardedSection}>
            {rewardCooldown > 0 ? (
              <AppButton
                label={`${rewardCooldown}s 后可再次观看`}
                variant="secondary"
                disabled
              />
            ) : (
              <AppButton
                label="观看广告支持 WakeFit"
                onPress={handleRewardedPress}
              />
            )}
          </View>
        </Section>
      )}

      <Text style={wakeFitStyles.statusText}>{state.status}</Text>
    </>
  );
}