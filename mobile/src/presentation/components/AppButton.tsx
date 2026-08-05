import React from 'react';
import { Pressable, Text } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: AppButtonProps) {
  const variantStyle = variant === 'primary'
    ? wakeFitStyles.primaryButton
    : variant === 'secondary'
      ? wakeFitStyles.secondaryButton
      : wakeFitStyles.quietButton;

  const variantTextStyle = variant === 'primary'
    ? wakeFitStyles.primaryButtonText
    : wakeFitStyles.secondaryButtonText;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        wakeFitStyles.button,
        variantStyle,
        pressed && !disabled ? wakeFitStyles.pressedButton : null,
        disabled ? wakeFitStyles.disabledButton : null,
      ]}
    >
      <Text style={[wakeFitStyles.buttonText, variantTextStyle]}>{label}</Text>
    </Pressable>
  );
}