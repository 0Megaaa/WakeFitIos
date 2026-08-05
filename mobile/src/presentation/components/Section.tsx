import React from 'react';
import { Text, View } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type SectionProps = {
  title: string;
  children: React.ReactNode;
};

export function Section({ title, children }: SectionProps) {
  return (
    <View style={wakeFitStyles.section}>
      <Text style={wakeFitStyles.sectionTitle}>{title}</Text>
      <View style={wakeFitStyles.sectionBody}>{children}</View>
    </View>
  );
}