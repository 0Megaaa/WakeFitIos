import React from 'react';

import { createWakeFitDependencies } from './createWakeFitDependencies.ts';
import { WakeFitRootScreen } from '../presentation/screens/WakeFitRootScreen.tsx';

const dependencies = createWakeFitDependencies();

export default function WakeFitApp() {
  return <WakeFitRootScreen dependencies={dependencies} />;
}