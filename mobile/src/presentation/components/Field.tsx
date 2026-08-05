import React from 'react';
import { Text, View } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type FieldProps = {
  label: string;
  children: React.ReactNode;
};

export function Field({ label, children }: FieldProps) {
  return (
    <View style={wakeFitStyles.field}>
      <Text style={wakeFitStyles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}