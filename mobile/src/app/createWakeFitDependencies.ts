import { MemoryStorage } from '../infrastructure/storage/MemoryStorage.ts';
import { FetchWakeFitApiClient } from '../infrastructure/api/FetchWakeFitApiClient.ts';
import { createWorkoutSyncQueue } from '../infrastructure/sync/createWorkoutSyncQueue.ts';
import { createPlatformServices } from '../platform/createPlatformServices.ts';
import type { WakeFitDependencies } from './types.ts';

let cachedDependencies: WakeFitDependencies | null = null;
let cachedDeviceId: string | null = null;

export function createSessionDeviceId(): string {
  if (cachedDeviceId === null) {
    cachedDeviceId = `wakefit-demo-${Math.random().toString(36).slice(2)}`;
  }
  return cachedDeviceId;
}

export function createWakeFitDependencies(): WakeFitDependencies {
  if (cachedDependencies) {
    return cachedDependencies;
  }

  const storage = new MemoryStorage();
  const platform = createPlatformServices();
  const deviceId = createSessionDeviceId();

  cachedDependencies = {
    storage,
    platform,
    deviceId,
    createApiClient: (options) => new FetchWakeFitApiClient(options),
    createSyncQueue: (apiClient) => createWorkoutSyncQueue({ storage, apiClient }),
  };

  return cachedDependencies;
}

export function resetWakeFitDependenciesForTesting(): void {
  cachedDependencies = null;
  cachedDeviceId = null;
}
