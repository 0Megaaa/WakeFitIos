// Re-export from the native module
// This file provides a stable import path for the ad module
export { WakeFitAds } from '../../../modules/wakefit-ads/src/WakeFitAds';
export type {
  AdsStatus,
  AdFormat,
  WakeFitAdsStatus,
  AdAvailabilityEvent,
  AdErrorEvent,
} from '../../../modules/wakefit-ads/src/types';
