import React from 'react';
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

export type WakeFitRootScreenProps = {
  dependencies: WakeFitDependencies;
  isDebugToolsEnabled?: boolean;
};

export function WakeFitRootScreen({ dependencies, isDebugToolsEnabled = defaultDebugEnabled }: WakeFitRootScreenProps) {
  const { state, actions } = useWakeFitController(dependencies, isDebugToolsEnabled);
  const tabs = buildWakeFitTabs(isDebugToolsEnabled);

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
          {state.tab === 'home' && <HomeTab state={state} actions={actions} isDebugToolsEnabled={isDebugToolsEnabled} />}
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