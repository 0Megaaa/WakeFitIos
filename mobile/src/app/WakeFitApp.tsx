import React, { useEffect } from 'react';
import { Platform } from 'react-native';

import { createWakeFitDependencies } from './createWakeFitDependencies.ts';
import { WakeFitRootScreen } from '../presentation/screens/WakeFitRootScreen.tsx';

// Platform-safe ad import - only on iOS
let wakefitAds: { WakeFitAds: { start: () => Promise<void> } } | null = null;
if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    wakefitAds = require('../platform/ads/WakeFitAds');
  } catch {
    // Ad module not available
  }
}

const dependencies = createWakeFitDependencies();

export default function WakeFitApp() {
  // Start ad system in background (non-blocking)
  useEffect(() => {
    if (wakefitAds?.WakeFitAds) {
      wakefitAds.WakeFitAds.start().catch((error) => {
        console.warn('WakeFitAds start failed:', error);
      });
    }
  }, []);

  return <WakeFitRootScreen dependencies={dependencies} />;
}