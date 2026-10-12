export type AdsStatus =
  | 'not_configured'
  | 'starting'
  | 'ready'
  | 'disabled'
  | 'failed';

export type AdFormat = 'banner' | 'native';

export interface WakeFitAdsStatus {
  state: AdsStatus;
  adsEnabled: boolean;
  suppressed: boolean;
  configLoaded: boolean;
  sdkInitialized: boolean;
  loggedIn: boolean;
}

export interface AdAvailabilityEvent {
  available: boolean;
  sceneID: string;
}

export interface AdErrorEvent {
  message: string;
  sceneID: string;
}
