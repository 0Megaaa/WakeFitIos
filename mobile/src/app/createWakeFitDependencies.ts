import { MemoryStorage } from '../infrastructure/storage/MemoryStorage.js';
import { FetchWakeFitApiClient } from '../infrastructure/api/FetchWakeFitApiClient.js';
import type { FetchWakeFitApiClientOptions } from '../infrastructure/api/FetchWakeFitApiClient.js';
import { createWorkoutSyncQueue } from '../infrastructure/sync/createWorkoutSyncQueue.js';
import { createDeviceAlarmAlert } from '../platform/alarm/createDeviceAlarmAlert.js';
import { ForegroundLocalAlarmScheduler } from '../platform/alarm/ForegroundLocalAlarmScheduler.js';
import { createDeviceLocalAlarmScheduler } from '../platform/alarm/createDeviceLocalAlarmScheduler.js';
import type { AlarmScheduler } from '../platform/alarm/ForegroundLocalAlarmScheduler.js';
import type { AlarmAlertService } from '../application/ports/AlarmAlertService.js';
import type { Storage } from '../application/ports/Storage.js';
import type { WakeFitApiClient } from '../application/ports/WakeFitApiClient.js';
import type { WorkoutSyncQueue } from '../application/ports/WorkoutSyncQueue.js';

export type WakeFitDependencies = {
  storage: Storage;
  deviceId: string;
  alarmScheduler: AlarmScheduler;
  alarmAlertService: AlarmAlertService;
  createApiClient(options: FetchWakeFitApiClientOptions): WakeFitApiClient;
  createSyncQueue(apiClient: WakeFitApiClient): WorkoutSyncQueue;
};

let cachedDependencies: WakeFitDependencies | null = null;

export function createWakeFitDependencies(): WakeFitDependencies {
  if (cachedDependencies) {
    return cachedDependencies;
  }

  const storage = new MemoryStorage();
  const deviceId = `wakefit-demo-${Math.random().toString(36).slice(2)}`;

  const foregroundScheduler = new ForegroundLocalAlarmScheduler({
    onFire: () => {
      // Foreground fallback - handled by WakeFitApp
    },
  });

  const alarmScheduler = createDeviceLocalAlarmScheduler(foregroundScheduler);
  const alarmAlertService = createDeviceAlarmAlert();

  const dependencies: WakeFitDependencies = {
    storage,
    deviceId,
    alarmScheduler,
    alarmAlertService,
    createApiClient: (options) => new FetchWakeFitApiClient(options),
    createSyncQueue: (apiClient) => createWorkoutSyncQueue({ storage, apiClient }),
  };

  cachedDependencies = dependencies;
  return dependencies;
}
