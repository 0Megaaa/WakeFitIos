import type { ExerciseType } from '../../features/alarms.ts';

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

export interface WakeFitApiClient {
  guestLogin(input: GuestLoginInput): Promise<GuestSession>;
  listAlarms(): Promise<ApiAlarm[]>;
  createAlarm(alarm: ApiAlarm): Promise<ApiAlarm>;
  updateAlarm(alarmId: number, alarm: ApiAlarm): Promise<ApiAlarm>;
  deleteAlarm(alarmId: number): Promise<void>;
  uploadWorkout(workout: ApiWorkoutUpload): Promise<WorkoutUploadResult>;
  fetchStreak(): Promise<StreakSummary>;
  fetchCalendar(input: CalendarFetchInput): Promise<WorkoutCalendar>;
}
