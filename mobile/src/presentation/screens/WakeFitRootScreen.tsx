import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StatusBar, Text, View } from 'react-native';

import type { WakeFitDependencies } from '../../app/types.ts';
import { useWakeFitController, type ControllerTab } from '../hooks/useWakeFitController.ts';
import { buildWakeFitTabs } from '../tabs/buildWakeFitTabs.ts';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';
import { StatusPill, TabButton } from '../components/index.ts';
import { AlarmTab } from './AlarmTab.tsx';
import { HistoryTab } from './HistoryTab.tsx';
import { HomeTab } from './HomeTab.tsx';
import { ChallengeModal } from './ChallengeModal.tsx';
import { isDebugToolsEnabled as defaultDebugEnabled } from '../../debug/debugAvailability.ts';
import { BackendDebugTab } from '../../debug/components/BackendDebugTab.tsx';
import { WakeFitAds } from '../../platform/ads/WakeFitAds.ts';
import type { WakeFitControllerState } from '../hooks/useWakeFitController.ts';

export type WakeFitRootScreenProps = {
  dependencies: WakeFitDependencies;
  isDebugToolsEnabled?: boolean;
};

/**
 * Compute ad suppression from WakeFit controller state.
 *
 * Ads MUST stay suppressed whenever:
 * - the initial pending-alarm check has not yet completed, or
 * - any alarm/challenge/completed flow is currently active.
 *
 * `flow` is only cleared when `closeCompletedAlarm()` runs, so the
 * completed modal stays in suppression until the user actively closes it.
 */
function computeSuppression(state: WakeFitControllerState): boolean {
  return !state.initialPendingAlarmCheckComplete || state.flow !== null;
}

export function WakeFitRootScreen({ dependencies, isDebugToolsEnabled = defaultDebugEnabled }: WakeFitRootScreenProps) {
  const { state, actions } = useWakeFitController(dependencies, isDebugToolsEnabled);
  const tabs = buildWakeFitTabs(isDebugToolsEnabled);

  const lastSuppressionRef = useRef<boolean | null>(null);
  const splashTriggeredRef = useRef(false);
  const interstitialStartedRef = useRef(false);
  const [rewardCooldown, setRewardCooldown] = useState(0);

  // Suppression: first call before startup so the manager opens in a safe
  // state. Subsequent calls keep it in sync with alarm/challenge state.
  useEffect(() => {
    const suppression = computeSuppression(state);
    if (lastSuppressionRef.current === suppression) return;
    lastSuppressionRef.current = suppression;
    void WakeFitAds.setSuppressed(suppression);
  }, [state.flow, state.initialPendingAlarmCheckComplete, state]);

  // Ads startup is fire-and-forget; the UI must not wait for it.
  useEffect(() => {
    void WakeFitAds.start();
  }, []);

  // Poll reward cooldown for the Home rewarded button.
  useEffect(() => {
    const interval = setInterval(async () => {
      const remaining = await WakeFitAds.getRewardCooldownRemaining();
      setRewardCooldown(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Splash once, only after suppression is safely off.
  useEffect(() => {
    if (!state.initialPendingAlarmCheckComplete) return;
    if (state.flow !== null) return;
    if (splashTriggeredRef.current) return;
    splashTriggeredRef.current = true;
    void WakeFitAds.showSplashOnce();
  }, [state.initialPendingAlarmCheckComplete, state.flow]);

  // Interstitial loop is owned here, scoped to the Home tab.
  useEffect(() => {
    const isHome = state.tab === 'home';
    if (isHome) {
      if (!interstitialStartedRef.current) {
        interstitialStartedRef.current = true;
        void WakeFitAds.startInterstitialLoop('home_timed');
      }
    } else if (interstitialStartedRef.current) {
      interstitialStartedRef.current = false;
      void WakeFitAds.stopInterstitialLoop();
    }
  }, [state.tab]);

  // On unmount: stop interstitial loop, leave suppression set up to UI caller.
  useEffect(() => {
    return () => {
      void WakeFitAds.stopInterstitialLoop();
    };
  }, []);

  const handleRewardedPress = useCallback(async () => {
    if (rewardCooldown > 0) return;
    const success = await WakeFitAds.showRewarded('home_rewarded');
    if (success) {
      setRewardCooldown(await WakeFitAds.getRewardCooldownRemaining());
    }
  }, [rewardCooldown]);

  return (
    <SafeAreaView style={wakeFitStyles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0e14" />
      <ChallengeModal state={state} actions={actions} isDebugToolsEnabled={isDebugToolsEnabled} />
      <View style={wakeFitStyles.appShell}>
        <View style={wakeFitStyles.header}>
          <View>
            <Text style={wakeFitStyles.brand}>WakeFit</Text>
            <Text style={wakeFitStyles.headerMeta}>健身闹钟 MVP</Text>
          </View>
          <StatusPill label={state.backendEnabled ? '后端同步' : '本地演示'} tone={state.backendEnabled ? 'blue' : 'green'} />
        </View>

        <ScrollView style={wakeFitStyles.content} contentContainerStyle={wakeFitStyles.contentInner}>
          {state.tab === 'home' && (
            <HomeTab
              state={state}
              actions={actions}
              isDebugToolsEnabled={isDebugToolsEnabled}
              rewardCooldown={rewardCooldown}
              onRewardedPress={handleRewardedPress}
            />
          )}
          {state.tab === 'alarm' && <AlarmTab state={state} actions={actions} />}
          {state.tab === 'history' && <HistoryTab state={state} actions={actions} />}
          {state.tab === 'backend' && isDebugToolsEnabled && <BackendDebugTab state={state} actions={actions} />}
        </ScrollView>

        <View style={wakeFitStyles.tabs}>
          {tabs.map((tab) => (
            <TabButton
              key={tab.key}
              active={state.tab === tab.key}
              label={tab.label}
              onPress={() => actions.setTab(tab.key as ControllerTab)}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}