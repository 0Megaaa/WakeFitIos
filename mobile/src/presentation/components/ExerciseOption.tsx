import React from 'react';
import { Pressable, Text } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type ExerciseOptionProps = {
  active: boolean;
  label: string;
  onPress: () => void;
};

export function ExerciseOption({ active, label, onPress }: ExerciseOptionProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[wakeFitStyles.exerciseOption, active ? wakeFitStyles.activeExerciseOption : null]}
    >
      <Text style={[wakeFitStyles.exerciseOptionText, active ? wakeFitStyles.activeExerciseOptionText : null]}>{label}</Text>
    </Pressable>
  );
}