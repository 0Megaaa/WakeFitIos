import type { ExerciseType } from '../exercise/types.ts';
import type { ApiWorkoutUpload } from '../workout/types.ts';

export type ChallengeStatus = 'idle' | 'ringing' | 'challenge' | 'completed';

export type ChallengeFlowOptions = {
  alarmId: number;
  targetCount: number;
  exerciseType?: ExerciseType;
  startedAt?: string;
  workoutDate: string;
};

export type ChallengeSnapshot = {
  status: ChallengeStatus;
  alarmId: number;
  exerciseType: ExerciseType;
  targetCount: number;
  count: number;
  workout: ApiWorkoutUpload | null;
};
