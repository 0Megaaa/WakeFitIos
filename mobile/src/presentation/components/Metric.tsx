import React from 'react';
import { Text, View } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type MetricTone = 'green' | 'blue' | 'gold';

export type MetricProps = {
  label: string;
  value: string;
  tone: MetricTone;
};

export function Metric({ label, value, tone }: MetricProps) {
  const toneStyle =
    tone === 'green'
      ? wakeFitStyles.greenMetric
      : tone === 'blue'
        ? wakeFitStyles.blueMetric
        : wakeFitStyles.goldMetric;

  return (
    <View style={[wakeFitStyles.metric, toneStyle]}>
      <Text style={wakeFitStyles.metricLabel}>{label}</Text>
      <Text style={wakeFitStyles.metricValue}>{value}</Text>
    </View>
  );
}