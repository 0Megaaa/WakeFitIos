import type { ExerciseType } from '../exercise/types.ts';

export type ApiWorkoutUpload = {
  id: string;
  alarmId?: number;
  workoutDate: string;
  exerciseType: ExerciseType;
  targetCount: number;
  actualCount: number;
  completed: boolean;
  startedAt: string;
  completedAt?: string;
};

export type CalendarWorkout = {
  id: number;
  alarmId?: number;
  workoutDate: string;
  exerciseType: ExerciseType;
  targetCount: number;
  actualCount: number;
  completed: boolean;
};

export type StreakSummary = {
  currentDays: number;
  longestDays: number;
  lastCompletedDate: string | null;
};
