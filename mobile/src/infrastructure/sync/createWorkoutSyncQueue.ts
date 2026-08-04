import type { Storage } from '../../application/ports/Storage.js';
import type { WorkoutSyncQueue } from '../../application/ports/WorkoutSyncQueue.js';
import type { WakeFitApiClient, WorkoutUploadResult } from '../../application/ports/WakeFitApiClient.js';
import type { ApiWorkoutUpload } from '../api/types.js';

export type WorkoutSyncQueueOptions = {
  storage: Storage;
  apiClient: Pick<WakeFitApiClient, 'uploadWorkout'>;
  storageKey?: string;
};

export type RecordWorkoutResult = {
  uploaded: boolean;
  queuedCount: number;
  uploadResult: WorkoutUploadResult | null;
};

export type FlushWorkoutResult = {
  uploadedCount: number;
  remainingCount: number;
};

const DEFAULT_STORAGE_KEY = 'wakefit:queued-workouts';

export function createWorkoutSyncQueue(options: WorkoutSyncQueueOptions): WorkoutSyncQueue {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  let operation = Promise.resolve();

  function enqueueOperation<T>(task: () => Promise<T>): Promise<T> {
    const next = operation.then(task, task);
    operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function getQueuedWorkouts(): Promise<ApiWorkoutUpload[]> {
    const raw = await options.storage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  async function saveQueuedWorkouts(workouts: ApiWorkoutUpload[]): Promise<void> {
    if (workouts.length === 0) {
      await options.storage.removeItem(storageKey);
      return;
    }

    await options.storage.setItem(storageKey, JSON.stringify(workouts));
  }

  async function queueWorkout(workout: ApiWorkoutUpload): Promise<ApiWorkoutUpload[]> {
    const queued = await getQueuedWorkouts();
    if (!queued.some((item) => item.id === workout.id)) {
      queued.push(workout);
    }
    await saveQueuedWorkouts(queued);
    return queued;
  }

  async function removeQueuedWorkout(workoutID: string): Promise<ApiWorkoutUpload[]> {
    const queued = await getQueuedWorkouts();
    const remaining = queued.filter((item) => item.id !== workoutID);
    await saveQueuedWorkouts(remaining);
    return remaining;
  }

  return {
    async recordWorkout(workout: ApiWorkoutUpload): Promise<RecordWorkoutResult> {
      return enqueueOperation(async () => {
        try {
          const uploadResult = await options.apiClient.uploadWorkout(workout);
          const queued = await removeQueuedWorkout(workout.id);
          return {
            uploaded: true,
            queuedCount: queued.length,
            uploadResult,
          };
        } catch {
          const queued = await queueWorkout(workout);
          return {
            uploaded: false,
            queuedCount: queued.length,
            uploadResult: null,
          };
        }
      });
    },

    async flush(): Promise<FlushWorkoutResult> {
      return enqueueOperation(async () => {
        const queued = await getQueuedWorkouts();
        const remaining: ApiWorkoutUpload[] = [];
        let uploadedCount = 0;

        for (let index = 0; index < queued.length; index += 1) {
          const workout = queued[index];
          try {
            await options.apiClient.uploadWorkout(workout);
            uploadedCount += 1;
          } catch {
            remaining.push(...queued.slice(index));
            break;
          }
        }

        await saveQueuedWorkouts(remaining);

        return {
          uploadedCount,
          remainingCount: remaining.length,
        };
      });
    },

    getQueuedWorkouts,

    async clear(): Promise<void> {
      await saveQueuedWorkouts([]);
    },
  };
}
