import React from 'react';
import { Text, View } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type StatusPillTone = 'green' | 'blue';

export type StatusPillProps = {
  label: string;
  tone: StatusPillTone;
};

export function StatusPill({ label, tone }: StatusPillProps) {
  const toneStyle = tone === 'green' ? wakeFitStyles.greenPill : wakeFitStyles.bluePill;
  return (
    <View style={[wakeFitStyles.statusPill, toneStyle]}>
      <Text style={wakeFitStyles.statusPillText}>{label}</Text>
    </View>
  );
}