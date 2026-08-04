import type { ExerciseType } from './alarms.ts';

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

export type WakeFitApiClient = {
  guestLogin(input: GuestLoginInput): Promise<GuestSession>;
  listAlarms(): Promise<ApiAlarm[]>;
  createAlarm(alarm: ApiAlarm): Promise<ApiAlarm>;
  updateAlarm(alarmId: number, alarm: ApiAlarm): Promise<ApiAlarm>;
  deleteAlarm(alarmId: number): Promise<void>;
  uploadWorkout(workout: ApiWorkoutUpload): Promise<WorkoutUploadResult>;
  fetchStreak(): Promise<StreakSummary>;
  fetchCalendar(input: CalendarFetchInput): Promise<WorkoutCalendar>;
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

export type FetchWakeFitApiClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
  getAuthToken?: () => string | null | undefined;
};

export class FetchWakeFitApiClient implements WakeFitApiClient {
  #baseUrl = '';
  #fetch: FetchLike;
  #getAuthToken: () => string | null | undefined;

  constructor(options: FetchWakeFitApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? defaultFetch;
    this.#getAuthToken = options.getAuthToken ?? (() => null);
  }

  async guestLogin(input: GuestLoginInput): Promise<GuestSession> {
    const response = await this.#request<{ token: string; user: { id: number } }>(
      'POST',
      '/api/v1/auth/guest',
      input,
      false,
    );

    return {
      token: response.token,
      userId: response.user.id,
    };
  }

  async listAlarms(): Promise<ApiAlarm[]> {
    const response = await this.#request<{ alarms: ApiAlarm[] }>('GET', '/api/v1/alarms');
    return response.alarms;
  }

  async createAlarm(alarm: ApiAlarm): Promise<ApiAlarm> {
    const response = await this.#request<{ alarm: ApiAlarm }>('POST', '/api/v1/alarms', alarm);
    return response.alarm;
  }

  async updateAlarm(alarmId: number, alarm: ApiAlarm): Promise<ApiAlarm> {
    const response = await this.#request<{ alarm: ApiAlarm }>(
      'PUT',
      `/api/v1/alarms/${encodeURIComponent(alarmId)}`,
      alarm,
    );
    return response.alarm;
  }

  async deleteAlarm(alarmId: number): Promise<void> {
    await this.#request<unknown>('DELETE', `/api/v1/alarms/${encodeURIComponent(alarmId)}`);
  }

  async uploadWorkout(workout: ApiWorkoutUpload): Promise<WorkoutUploadResult> {
    const response = await this.#request<{ workout: { id: number } }>(
      'POST',
      '/api/v1/workouts',
      workout,
    );
    return { id: response.workout.id };
  }

  async fetchStreak(): Promise<StreakSummary> {
    return this.#request<StreakSummary>('GET', '/api/v1/streak');
  }

  async fetchCalendar(input: CalendarFetchInput): Promise<WorkoutCalendar> {
    const params = new URLSearchParams({ month: input.month });
    return this.#request<WorkoutCalendar>('GET', `/api/v1/workouts/calendar?${params.toString()}`);
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    useAuth = true,
  ): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (useAuth) {
      const token = this.#getAuthToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const response = await this.#fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    if (!response.ok) {
      const message = parseErrorMessage(text);
      throw new Error(
        `WakeFit API request failed: ${method} ${url} returned ${response.status}${message}`,
      );
    }

    return (text ? JSON.parse(text) : null) as T;
  }
}

const defaultFetch: FetchLike = async (url, init) => {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Fetch is not available in this runtime.');
  }

  return globalThis.fetch(url, init);
};

function parseErrorMessage(text: string): string {
  if (!text) {
    return '';
  }

  try {
    const body = JSON.parse(text);
    return body.error || body.message ? `: ${body.error ?? body.message}` : '';
  } catch {
    return `: ${text}`;
  }
}
