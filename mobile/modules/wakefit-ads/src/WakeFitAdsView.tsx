import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  requireNativeViewManager,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'expo-modules-core';

import type { AdAvailabilityEvent, AdErrorEvent, AdFormat } from './types';

interface NativeAdViewProps extends ViewProps {
  format: AdFormat;
  sceneID: string;
  onAvailabilityChange?: (event: NativeSyntheticEvent<AdAvailabilityEvent>) => void;
  onAdError?: (event: NativeSyntheticEvent<AdErrorEvent>) => void;
}

let cachedNativeView: React.ComponentType<NativeAdViewProps> | null | undefined;

function getNativeAdView(): React.ComponentType<NativeAdViewProps> | null {
  if (cachedNativeView !== undefined) {
    return cachedNativeView;
  }

  if (Platform.OS !== 'ios') {
    cachedNativeView = null;
    return null;
  }

  try {
    cachedNativeView = requireNativeViewManager('WakeFitAdsView') as React.ComponentType<NativeAdViewProps>;
  } catch {
    cachedNativeView = null;
  }

  return cachedNativeView;
}

export interface WakeFitAdViewProps {
  format: AdFormat;
  sceneID: string;
  onAvailabilityChange?: (available: boolean) => void;
  onAdError?: (message: string) => void;
  style?: ViewProps['style'];
}

export function WakeFitAdView({
  format,
  sceneID,
  onAvailabilityChange,
  onAdError,
  style,
}: WakeFitAdViewProps) {
  const NativeView = getNativeAdView();
  const [available, setAvailable] = useState(false);

  const handleAvailabilityChange = useCallback(
    (event: NativeSyntheticEvent<AdAvailabilityEvent>) => {
      const isAvailable = event.nativeEvent.available;
      setAvailable(isAvailable);
      onAvailabilityChange?.(isAvailable);
    },
    [onAvailabilityChange]
  );

  const handleAdError = useCallback(
    (event: NativeSyntheticEvent<AdErrorEvent>) => {
      onAdError?.(event.nativeEvent.message);
    },
    [onAdError]
  );

  // Collapse to zero height when not available on iOS
  const containerStyle = Platform.OS === 'ios' && !available
    ? [styles.container, styles.collapsed, style]
    : [styles.container, style];

  if (!NativeView) {
    // Graceful fallback for non-iOS or when native view is unavailable
    return <View style={containerStyle} />;
  }

  return (
    <NativeView
      style={containerStyle}
      format={format}
      sceneID={sceneID}
      onAvailabilityChange={handleAvailabilityChange}
      onAdError={handleAdError}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 50,
  },
  collapsed: {
    minHeight: 0,
    height: 0,
  },
});
