import type { WorkoutSyncQueue } from '../ports/WorkoutSyncQueue.js';
import type { ApiWorkoutUpload } from '../ports/WakeFitApiClient.js';
import type { RecordWorkoutResult } from '../ports/WorkoutSyncQueue.js';

export type RecordCompletedWorkoutOptions = {
  syncQueue: WorkoutSyncQueue;
  workout: ApiWorkoutUpload;
};

export async function recordCompletedWorkout(
  options: RecordCompletedWorkoutOptions,
): Promise<RecordWorkoutResult> {
  return options.syncQueue.recordWorkout(options.workout);
}
