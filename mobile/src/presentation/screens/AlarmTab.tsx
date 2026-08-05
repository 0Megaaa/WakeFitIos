import React from 'react';
import { Switch, Text, TextInput, View } from 'react-native';

import type { WakeFitControllerState, WakeFitControllerActions } from '../hooks/useWakeFitController.ts';
import { AppButton, Field, Section } from '../components/index.ts';
import { ExerciseOption } from '../components/ExerciseOption.tsx';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type AlarmTabProps = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
};

export function AlarmTab({ state, actions }: AlarmTabProps) {
  return (
    <Section title="闹钟设置">
      <Field label="时间">
        <TextInput
          style={wakeFitStyles.input}
          value={state.timeDraft}
          onChangeText={actions.setTimeDraft}
          placeholder="07:30"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
      </Field>
      <Field label="目标次数">
        <View style={wakeFitStyles.stepper}>
          <AppButton
            label="-1"
            variant="secondary"
            onPress={() =>
              actions.setTargetDraft(
                String(Math.max(1, Number.parseInt(state.targetDraft || '1', 10) - 1)),
              )
            }
          />
          <TextInput
            style={[wakeFitStyles.input, wakeFitStyles.stepperInput]}
            value={state.targetDraft}
            onChangeText={actions.setTargetDraft}
            keyboardType="number-pad"
            maxLength={3}
          />
          <AppButton
            label="+1"
            variant="secondary"
            onPress={() =>
              actions.setTargetDraft(
                String(Math.min(100, Number.parseInt(state.targetDraft || '0', 10) + 1)),
              )
            }
          />
        </View>
      </Field>
      <Field label="动作">
        <View style={wakeFitStyles.exerciseOptions}>
          <ExerciseOption
            label="俯卧撑"
            active={state.exerciseDraft === 'push_up'}
            onPress={() => actions.setExerciseDraft('push_up')}
          />
          <ExerciseOption
            label="深蹲"
            active={state.exerciseDraft === 'squat'}
            onPress={() => actions.setExerciseDraft('squat')}
          />
        </View>
      </Field>
      <View style={wakeFitStyles.switchRow}>
        <View>
          <Text style={wakeFitStyles.fieldLabel}>启用闹钟</Text>
          <Text style={wakeFitStyles.subtleText}>{state.alarm.timezone}</Text>
        </View>
        <Switch
          value={state.alarmEnabled}
          onValueChange={actions.setAlarmEnabled}
          trackColor={{ false: '#26303f', true: 'rgba(229, 72, 77, 0.5)' }}
          thumbColor={state.alarmEnabled ? '#e5484d' : '#8b95a8'}
        />
      </View>
      <View style={wakeFitStyles.buttonRow}>
        <AppButton label={state.busy ? '保存中' : '保存'} onPress={() => void actions.saveAlarm()} disabled={state.busy} />
        <AppButton label="返回首页" variant="secondary" onPress={() => actions.setTab('home')} />
      </View>
      <Text style={wakeFitStyles.statusText}>{state.status}</Text>
    </Section>
  );
}