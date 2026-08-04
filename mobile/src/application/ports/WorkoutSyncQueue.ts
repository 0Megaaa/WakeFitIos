import type { ApiWorkoutUpload, WorkoutUploadResult } from './WakeFitApiClient.ts';

export type RecordWorkoutResult = {
  uploaded: boolean;
  queuedCount: number;
  uploadResult: WorkoutUploadResult | null;
};

export type FlushWorkoutResult = {
  uploadedCount: number;
  remainingCount: number;
};

export interface WorkoutSyncQueue {
  recordWorkout(workout: ApiWorkoutUpload): Promise<RecordWorkoutResult>;
  flush(): Promise<FlushWorkoutResult>;
}
