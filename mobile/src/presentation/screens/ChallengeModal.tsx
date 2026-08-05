import React from 'react';
import { Modal, Pressable, SafeAreaView, Text, View } from 'react-native';

import type { WakeFitControllerState, WakeFitControllerActions } from '../hooks/useWakeFitController.ts';
import { AlarmClock, AppButton, PosePreview } from '../components/index.ts';
import { NativePoseCameraView } from '../../platform/camera/NativePoseCameraView.tsx';
import { shouldUseCameraFirstChallengeLayout } from '../camera/index.ts';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';
import { getExerciseLabel } from './exerciseLabel.ts';

export type ChallengeModalProps = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
  isDebugToolsEnabled: boolean;
};

export function ChallengeModal({ state, actions, isDebugToolsEnabled }: ChallengeModalProps) {
  const status = state.snapshot?.status ?? 'idle';
  const canClose = status === 'completed';
  const cameraFirstLayout = shouldUseCameraFirstChallengeLayout({ realCameraEnabled: state.realCameraEnabled });
  const visible = state.flow !== null && status !== 'idle';
  const activeExerciseLabel = getExerciseLabel(state.snapshot?.exerciseType ?? state.alarm.exerciseType);
  const progressPercent = state.snapshot
    ? Math.min(100, Math.round((state.snapshot.count / state.snapshot.targetCount) * 100))
    : 0;

  const noop = () => {
    // intentionally empty - prevents Android back from closing during ringing/challenge
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={canClose ? actions.closeCompletedAlarm : noop}
    >
      <SafeAreaView style={wakeFitStyles.alarmModalShell}>
        <View style={wakeFitStyles.alarmModalHeader}>
          <Text style={wakeFitStyles.alarmModalBrand}>WakeFit</Text>
          <Text style={wakeFitStyles.alarmModalMeta}>{activeExerciseLabel} · {state.snapshot?.targetCount ?? 0} 次</Text>
        </View>

        {status === 'ringing' && (
          <View style={wakeFitStyles.alarmModalBody}>
            <Text style={wakeFitStyles.alarmRingLabel}>闹钟响铃</Text>
            <AlarmClock />
            <Text style={wakeFitStyles.alarmModalDetail}>完成 {state.snapshot?.targetCount ?? 0} 次{activeExerciseLabel}后才能关闭闹钟</Text>
            <Pressable
              accessibilityRole="button"
              onPress={actions.beginChallenge}
              style={({ pressed }) => [wakeFitStyles.alarmActionButton, pressed ? wakeFitStyles.alarmActionButtonPressed : null]}
            >
              <Text style={wakeFitStyles.alarmActionButtonText}>开始{activeExerciseLabel}</Text>
            </Pressable>
          </View>
        )}

        {status === 'challenge' && (
          <View style={[wakeFitStyles.alarmModalBody, wakeFitStyles.alarmChallengeBody, cameraFirstLayout ? wakeFitStyles.alarmCameraFirstBody : null]}>
            {cameraFirstLayout ? (
              <View style={wakeFitStyles.alarmCameraStage}>
                <NativePoseCameraView
                  style={wakeFitStyles.alarmCameraPreview}
                  cameraFacing="front"
                  onPoseFrame={actions.handleRealPoseFrame}
                  onCameraError={(message) => {
                    void message;
                  }}
                  fallback={
                    <View style={wakeFitStyles.cameraFallback}>
                      <Text style={wakeFitStyles.emptyTitle}>真实相机未加载</Text>
                      <Text style={wakeFitStyles.cameraFallbackText}>请使用 Android development build 测试 ML Kit 识别。</Text>
                    </View>
                  }
                />
                <View style={wakeFitStyles.alarmCameraCounter} pointerEvents="none">
                  <Text style={wakeFitStyles.alarmCameraCounterText}>{state.snapshot?.count ?? 0}/{state.snapshot?.targetCount ?? 0}</Text>
                  <Text style={wakeFitStyles.alarmCameraCounterLabel}>{activeExerciseLabel}</Text>
                </View>
                <View style={wakeFitStyles.alarmCameraHud}>
                  <View style={[wakeFitStyles.progressTrack, wakeFitStyles.alarmProgressTrack]}>
                    <View style={[wakeFitStyles.progressFill, { width: `${progressPercent}%` }]} />
                  </View>
                  <View style={wakeFitStyles.buttonRow}>
                    <AppButton label="关闭相机" variant="secondary" onPress={() => void actions.toggleRealCamera()} disabled={state.busy} />
                    {isDebugToolsEnabled && (
                      <AppButton label="模拟一次" onPress={actions.simulateOnePushUp} disabled={state.busy} />
                    )}
                  </View>
                  <Text style={wakeFitStyles.alarmModalStatus}>{state.status}</Text>
                </View>
              </View>
            ) : (
              <>
                <PosePreview progress={progressPercent} />
                <View style={wakeFitStyles.alarmProgressBlock}>
                  <Text style={wakeFitStyles.alarmProgressText}>{state.snapshot?.count ?? 0}/{state.snapshot?.targetCount ?? 0}</Text>
                  <Text style={wakeFitStyles.alarmModalDetail}>{activeExerciseLabel}</Text>
                </View>
                <View style={[wakeFitStyles.progressTrack, wakeFitStyles.alarmProgressTrack]}>
                  <View style={[wakeFitStyles.progressFill, { width: `${progressPercent}%` }]} />
                </View>
                <View style={wakeFitStyles.buttonRow}>
                  <AppButton label="真实相机" variant="secondary" onPress={() => void actions.toggleRealCamera()} disabled={state.busy} />
                  {isDebugToolsEnabled && (
                    <AppButton label="模拟一次" onPress={actions.simulateOnePushUp} disabled={state.busy} />
                  )}
                </View>
                <Text style={wakeFitStyles.alarmModalStatus}>{state.status}</Text>
              </>
            )}
          </View>
        )}

        {status === 'completed' && (
          <View style={wakeFitStyles.alarmModalBody}>
            <View style={wakeFitStyles.alarmCompleteBadge}>
              <Text style={wakeFitStyles.alarmCompleteBadgeText}>✓</Text>
            </View>
            <Text style={wakeFitStyles.alarmCompleteTitle}>闹钟已关闭</Text>
            <Text style={wakeFitStyles.alarmProgressText}>{state.snapshot?.count}/{state.snapshot?.targetCount}</Text>
            <Text style={wakeFitStyles.alarmModalDetail}>{state.status}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={actions.closeCompletedAlarm}
              style={({ pressed }) => [wakeFitStyles.alarmActionButton, wakeFitStyles.alarmCompleteButton, pressed ? wakeFitStyles.alarmActionButtonPressed : null]}
            >
              <Text style={wakeFitStyles.alarmActionButtonText}>回到首页</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}