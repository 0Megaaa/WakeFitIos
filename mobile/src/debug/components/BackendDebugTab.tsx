import React from 'react';
import { Switch, Text, TextInput, View } from 'react-native';

import type { WakeFitControllerState, WakeFitControllerActions } from '../../presentation/hooks/useWakeFitController.ts';
import { AppButton, Field, Section } from '../../presentation/components/index.ts';
import { wakeFitStyles } from '../../presentation/styles/wakeFitStyles.ts';

export type BackendDebugTabProps = {
  state: WakeFitControllerState;
  actions: WakeFitControllerActions;
};

export function BackendDebugTab({ state, actions }: BackendDebugTabProps) {
  return (
    <Section title="后端连接">
      <Field label="API 地址">
        <TextInput
          style={wakeFitStyles.input}
          value={state.backendUrl}
          onChangeText={actions.setBackendUrl}
          placeholder="http://192.168.1.20:8080"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </Field>
      <View style={wakeFitStyles.switchRow}>
        <View>
          <Text style={wakeFitStyles.fieldLabel}>使用后端同步</Text>
          <Text style={wakeFitStyles.subtleText}>{state.token ? '访客 token 已存在' : '尚未登录'}</Text>
        </View>
        <Switch
          value={state.backendEnabled}
          onValueChange={actions.setBackendEnabled}
          trackColor={{ false: '#26303f', true: 'rgba(91, 141, 239, 0.5)' }}
          thumbColor={state.backendEnabled ? '#5b8def' : '#8b95a8'}
        />
      </View>
      <View style={wakeFitStyles.buttonRow}>
        <AppButton label="访客登录" onPress={() => void actions.loginBackend()} disabled={state.busy || !state.backendEnabled} />
        <AppButton label="刷新数据" variant="secondary" onPress={() => void actions.refreshDashboard()} disabled={state.busy || !state.backendEnabled} />
      </View>
      <View style={wakeFitStyles.buttonRow}>
        <AppButton label="上传队列" variant="secondary" onPress={() => void actions.flushQueue()} disabled={state.busy || !state.backendEnabled} />
        <AppButton label="本地模式" variant="quiet" onPress={() => actions.setBackendEnabled(false)} />
      </View>
      <Text style={wakeFitStyles.statusText}>{state.status}</Text>
    </Section>
  );
}