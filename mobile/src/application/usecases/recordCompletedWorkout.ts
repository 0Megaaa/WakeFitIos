import type { WorkoutSyncQueue } from '../ports/WorkoutSyncQueue.ts';
import type { RecordWorkoutResult } from '../ports/WorkoutSyncQueue.ts';
import type { ApiWorkoutUpload } from '../ports/WakeFitApiClient.ts';

export type RecordCompletedWorkoutOptions = {
  syncQueue: WorkoutSyncQueue;
  workout: ApiWorkoutUpload;
};

export async function recordCompletedWorkout(
  options: RecordCompletedWorkoutOptions,
): Promise<RecordWorkoutResult> {
  return options.syncQueue.recordWorkout(options.workout);
}
