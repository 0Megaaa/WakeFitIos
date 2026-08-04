import React, { useMemo } from 'react';
import { Platform, Text, View, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

import type { PoseFrame } from '../../domain/exercise/types.ts';
import { supportsNativePoseCameraPlatform } from './nativePoseCameraPlatform.ts';
import { nativePoseEventToFrame, type NativePoseFrameEvent } from './poseFrameAdapter.ts';

type NativePoseCameraProps = {
  style?: StyleProp<ViewStyle>;
  cameraFacing?: 'front' | 'back';
  onPoseFrame: (frame: PoseFrame) => void;
  onCameraError?: (message: string) => void;
  fallback?: React.ReactNode;
};

type NativePoseCameraViewProps = {
  style?: StyleProp<ViewStyle>;
  cameraFacing: 'front' | 'back';
  onPoseFrame: (event: NativeSyntheticEvent<NativePoseFrameEvent>) => void;
  onCameraError: (event: NativeSyntheticEvent<{ message?: string }>) => void;
};

let cachedNativeView:
  | React.ComponentType<NativePoseCameraViewProps>
  | null
  | undefined;

export function NativePoseCameraView({
  style,
  cameraFacing = 'front',
  onPoseFrame,
  onCameraError,
  fallback,
}: NativePoseCameraProps) {
  const NativeView = useMemo(() => getNativePoseCameraView(), []);

  if (!supportsNativePoseCameraPlatform(Platform.OS) || !NativeView) {
    return (
      <View style={style}>
        {fallback ?? (
          <Text>Real pose recognition needs an iOS or Android development build.</Text>
        )}
      </View>
    );
  }

  return (
    <NativeView
      style={style}
      cameraFacing={cameraFacing}
      onPoseFrame={(event) => {
        const frame = nativePoseEventToFrame(event.nativeEvent);
        if (frame) {
          onPoseFrame(frame);
        }
      }}
      onCameraError={(event) => {
        onCameraError?.(event.nativeEvent.message ?? 'POSE_CAMERA_ERROR');
      }}
    />
  );
}

function getNativePoseCameraView() {
  if (cachedNativeView !== undefined) {
    return cachedNativeView;
  }

  try {
    cachedNativeView = requireNativeViewManager('WakeFitPoseDetector') as React.ComponentType<NativePoseCameraViewProps>;
  } catch {
    cachedNativeView = null;
  }

  return cachedNativeView;
}
