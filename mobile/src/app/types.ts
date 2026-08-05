import type { Storage } from '../application/ports/Storage.ts';
import type { WakeFitApiClient } from '../application/ports/WakeFitApiClient.ts';
import type { WorkoutSyncQueue } from '../application/ports/WorkoutSyncQueue.ts';
import type { PlatformServices } from '../platform/types.ts';
import type { FetchWakeFitApiClientOptions } from '../infrastructure/api/FetchWakeFitApiClient.ts';

export type WakeFitDependencies = {
  storage: Storage;
  deviceId: string;
  platform: PlatformServices;
  createApiClient(options: FetchWakeFitApiClientOptions): WakeFitApiClient;
  createSyncQueue(apiClient: WakeFitApiClient): WorkoutSyncQueue;
};