import React from 'react';
import { Text, View } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export type PosePreviewProps = {
  progress: number;
};

export function PosePreview({ progress }: PosePreviewProps) {
  return (
    <View style={wakeFitStyles.posePreview}>
      <View style={wakeFitStyles.poseHead} />
      <View style={wakeFitStyles.poseTorso} />
      <View style={wakeFitStyles.poseArmLeft} />
      <View style={wakeFitStyles.poseArmRight} />
      <View style={wakeFitStyles.poseFloor} />
      <Text style={wakeFitStyles.poseProgress}>{progress}%</Text>
    </View>
  );
}