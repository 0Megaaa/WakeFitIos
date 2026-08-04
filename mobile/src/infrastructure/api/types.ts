import type { ExerciseType } from '../../domain/alarm/alarm.ts';

export type ApiAlarm = {
  id?: number;
  localAlarmId: string;
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  targetCount: number;
  exerciseType: ExerciseType;
};

export type GuestLoginInput = {
  deviceId: string;
};

export type GuestSession = {
  token: string;
  userId: number;
};

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

export type WorkoutUploadResult = {
  id: number;
};

export type StreakSummary = {
  currentDays: number;
  longestDays: number;
  lastCompletedDate: string | null;
};

export type CalendarFetchInput = {
  month: string;
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

export type WorkoutCalendar = {
  workouts: CalendarWorkout[];
};

export type FetchRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type FetchLike = (
  url: string,
  init?: FetchRequestInit,
) => Promise<FetchResponse>;
