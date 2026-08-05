import type { WorkoutSyncQueue } from '../ports/WorkoutSyncQueue.ts';
import type { RecordWorkoutResult } from '../ports/WorkoutSyncQueue.ts';
import type { FlushWorkoutResult } from '../ports/WorkoutSyncQueue.ts';

export type FlushWorkoutQueueOptions = {
  syncQueue: WorkoutSyncQueue;
};

export async function flushWorkoutQueue(options: FlushWorkoutQueueOptions): Promise<FlushWorkoutResult> {
  return options.syncQueue.flush();
}
