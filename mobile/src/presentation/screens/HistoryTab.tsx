import React from 'react';
import { Text, View } from 'react-native';

import type { WakeFitControllerState, WakeFitControllerActions } from '../hooks/useWakeFitController.ts';
import { AppButton, EmptyState, Section } from '../components/index.ts';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';
import { getExerciseLabel } from './exerciseLabel.ts';

export type HistoryTabProps = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
};

export function HistoryTab({ state, actions }: HistoryTabProps) {
  return (
    <>
      <Section title="训练记录">
        {state.workouts.length === 0 ? (
          <EmptyState title="暂无记录" detail="完成一次挑战后会出现在这里。" />
        ) : (
          state.workouts.map((item) => (
            <View key={`${item.id}-${item.workoutDate}`} style={wakeFitStyles.workoutRow}>
              <View>
                <Text style={wakeFitStyles.workoutDate}>{item.workoutDate}</Text>
                <Text style={wakeFitStyles.subtleText}>
                  {item.completed ? '已完成' : '未完成'} · {getExerciseLabel(item.exerciseType)}
                </Text>
              </View>
              <Text style={wakeFitStyles.workoutCount}>{item.actualCount}/{item.targetCount}</Text>
            </View>
          ))
        )}
      </Section>
      <View style={wakeFitStyles.buttonRow}>
        <AppButton label="刷新后端" variant="secondary" onPress={() => void actions.refreshDashboard()} disabled={state.busy || !state.backendEnabled} />
        <AppButton label="返回首页" onPress={() => actions.setTab('home')} />
      </View>
    </>
  );
}