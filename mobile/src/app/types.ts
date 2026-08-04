export type WakeFitDependencies = {
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  platformServices: {
    scheduler: {
      schedule(request: { alarmId: string; fireAt: string; label?: string; timeOfDay?: string; targetCount?: number; exerciseType?: 'push_up' | 'squat' }): Promise<void>;
      cancel(alarmId: string): Promise<void>;
    };
    alert: {
      start(): Promise<void>;
      stop(): Promise<void>;
    };
  };
  createApiClient: (options: { baseUrl: string; getAuthToken?: () => string | null }) => {
    guestLogin(input: { deviceId: string }): Promise<{ token: string; userId: number }>;
    updateAlarm(alarmId: number, alarm: unknown): Promise<unknown>;
    createAlarm(alarm: unknown): Promise<unknown>;
    fetchStreak(): Promise<{ currentDays: number; longestDays: number; lastCompletedDate: string | null }>;
    fetchCalendar(input: { month: string }): Promise<{ workouts: unknown[] }>;
  };
  syncQueue: {
    recordWorkout(workout: unknown): Promise<{ uploaded: boolean; queuedCount: number; uploadResult: { id: number } | null }>;
    flush(): Promise<{ uploadedCount: number; remainingCount: number }>;
  };
  deviceId: string;
};
