import { MemoryStorage } from '../features/storage.js';
import { FetchWakeFitApiClient } from '../features/api.js';
import { createWorkoutSyncQueue } from '../features/syncQueue.js';
import { createDeviceLocalAlarmScheduler } from '../features/deviceLocalAlarm.js';
import { createDeviceAlarmAlert } from '../features/deviceAlarmAlert.js';
import { ForegroundLocalAlarmScheduler } from '../features/localAlarm.js';

interface Dependencies {
  storage: MemoryStorage;
  deviceId: string;
  platformServices: {
    scheduler: ReturnType<typeof createDeviceLocalAlarmScheduler>;
    alert: ReturnType<typeof createDeviceAlarmAlert>;
  };
}

let cachedDependencies: Dependencies | null = null;

export function createWakeFitDependencies(): Dependencies {
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

  const alertService = createDeviceAlarmAlert();

  const dependencies: Dependencies = {
    storage,
    deviceId,
    platformServices: {
      scheduler: createDeviceLocalAlarmScheduler(foregroundScheduler),
      alert: alertService,
    },
  };

  cachedDependencies = dependencies;
  return dependencies;
}

export function createWakeFitApiClient(baseUrl: string, getAuthToken?: () => string | null): FetchWakeFitApiClient {
  return new FetchWakeFitApiClient({ baseUrl, getAuthToken });
}

export function createWakeFitSyncQueue(storage: MemoryStorage, apiClient: FetchWakeFitApiClient) {
  return createWorkoutSyncQueue({ storage, apiClient });
}
