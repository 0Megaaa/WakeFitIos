import type { Storage } from '../../application/ports/Storage.js';
import type { WakeFitApiClient, StreakSummary, WorkoutCalendar } from '../../application/ports/WakeFitApiClient.js';
import type { ApiWorkoutUpload } from '../api/types.js';

export type WakeFitSession = {
  token: string;
  userId: number;
};

export type AppSessionOptions = {
  storage: Storage;
  apiClient: Pick<WakeFitApiClient, 'guestLogin' | 'fetchStreak' | 'fetchCalendar'>;
  deviceId: string;
  tokenKey?: string;
  userIDKey?: string;
};

export type DashboardRefreshInput = {
  month: string;
};

export type DashboardData = {
  streak: StreakSummary;
  calendar: WorkoutCalendar;
};

const DEFAULT_TOKEN_KEY = 'wakefit:auth-token';
const DEFAULT_USER_ID_KEY = 'wakefit:user-id';

export function createAppSession(options: AppSessionOptions) {
  const tokenKey = options.tokenKey ?? DEFAULT_TOKEN_KEY;
  const userIDKey = options.userIDKey ?? DEFAULT_USER_ID_KEY;

  return {
    async ensureGuestSession(): Promise<WakeFitSession> {
      const existingToken = await options.storage.getItem(tokenKey);
      const existingUserID = await options.storage.getItem(userIDKey);
      if (existingToken && existingUserID) {
        return {
          token: existingToken,
          userId: Number(existingUserID),
        };
      }

      const session = await options.apiClient.guestLogin({ deviceId: options.deviceId });
      await options.storage.setItem(tokenKey, session.token);
      await options.storage.setItem(userIDKey, String(session.userId));

      return session;
    },

    async getToken(): Promise<string | null> {
      return options.storage.getItem(tokenKey);
    },

    async refreshDashboard(input: DashboardRefreshInput): Promise<DashboardData> {
      const [streak, calendar] = await Promise.all([
        options.apiClient.fetchStreak(),
        options.apiClient.fetchCalendar({ month: input.month }),
      ]);

      return { streak, calendar };
    },

    async clear(): Promise<void> {
      await options.storage.removeItem(tokenKey);
      await options.storage.removeItem(userIDKey);
    },
  };
}
