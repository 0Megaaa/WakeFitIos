import React from 'react';
import { Pressable, Text } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type TabButtonProps = {
  active: boolean;
  label: string;
  onPress: () => void;
};

export function TabButton({ active, label, onPress }: TabButtonProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[wakeFitStyles.tabButton, active ? wakeFitStyles.activeTabButton : null]}>
      <Text style={[wakeFitStyles.tabButtonText, active ? wakeFitStyles.activeTabButtonText : null]}>{label}</Text>
    </Pressable>
  );
}