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
  const [adsReady, setAdsReady] = useState(false);
  const [rewardCooldown, setRewardCooldown] = useState(0);

  // Suppression: first call before startup so the manager opens in a safe
  // state. Subsequent calls keep it in sync with alarm/challenge state.
  useEffect(() => {
    const suppression = computeSuppression(state);
    if (lastSuppressionRef.current === suppression) return;
    lastSuppressionRef.current = suppression;
    void WakeFitAds.setSuppressed(suppression);
  }, [state.flow, state.initialPendingAlarmCheckComplete, state]);

  // Ads startup: await both the start() promise and the post-start status
  // so the rest of this component only acts after the manager has reached
  // a real terminal state. The native `start()` is now genuinely async and
  // resolves only when startup is finished (ready / disabled / failed /
  // notConfigured). An unmount-cancellation flag prevents setState on an
  // unmounted component.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await WakeFitAds.start();
      const status = await WakeFitAds.getStatus();
      if (cancelled) return;
      setAdsReady(status.state === 'ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll reward cooldown for the Home rewarded button.
  useEffect(() => {
    const interval = setInterval(async () => {
      const remaining = await WakeFitAds.getRewardCooldownRemaining();
      setRewardCooldown(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Splash: re-evaluated whenever ads readiness, the pending-alarm check,
  // or the active flow flips. The native manager enforces session-once
  // semantics (`splashShownInSession`), so this effect is allowed to call
  // `showSplashOnce()` on every safe-state transition; the manager will
  // no-op once the splash has actually shown.
  //
  // If the pending-alarm check completes before the ad system is ready,
  // the first run is a no-op and we re-fire automatically the moment
  // `adsReady` flips false -> true. If an alarm / challenge is ringing
  // (`flow !== null`) the effect deliberately does not show.
  useEffect(() => {
    if (!adsReady) return;
    if (!state.initialPendingAlarmCheckComplete) return;
    if (state.flow !== null) return;
    void WakeFitAds.showSplashOnce();
  }, [adsReady, state.initialPendingAlarmCheckComplete, state.flow]);

  // Interstitial loop: standard React effect. Starts ONLY when the ad
  // system is ready AND the Home tab is active. The cleanup function
  // guarantees the loop is stopped on tab change, on `adsReady` flipping
  // back to false, and on unmount. The previous `interstitialStartedRef`
  // is gone; the first timer is now scheduled strictly after remote
  // config has been loaded, so it uses the real `interstitialAdInterval`
  // value.
  useEffect(() => {
    if (!adsReady || state.tab !== 'home') {
      void WakeFitAds.stopInterstitialLoop();
      return;
    }
    void WakeFitAds.startInterstitialLoop('home_timed');
    return () => {
      void WakeFitAds.stopInterstitialLoop();
    };
  }, [adsReady, state.tab]);

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