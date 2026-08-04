import type { WorkoutSyncQueue } from '../ports/WorkoutSyncQueue.js';
import type { FlushWorkoutResult } from '../ports/WorkoutSyncQueue.js';

export type FlushWorkoutQueueOptions = {
  syncQueue: WorkoutSyncQueue;
};

export async function flushWorkoutQueue(options: FlushWorkoutQueueOptions): Promise<FlushWorkoutResult> {
  return options.syncQueue.flush();
}
