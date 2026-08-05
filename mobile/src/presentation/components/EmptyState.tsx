import React from 'react';
import { Text, View } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type EmptyStateProps = {
  title: string;
  detail: string;
};

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <View style={wakeFitStyles.emptyState}>
      <Text style={wakeFitStyles.emptyTitle}>{title}</Text>
      <Text style={wakeFitStyles.subtleText}>{detail}</Text>
    </View>
  );
}