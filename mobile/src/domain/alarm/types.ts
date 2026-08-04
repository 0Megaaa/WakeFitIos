import type { ExerciseType } from '../exercise/types.ts';

export type LocalAlarmConfig = {
  id: string;
  serverId?: number;
  label: string;
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  targetCount: number;
  exerciseType: ExerciseType;
  createdAt: string;
  updatedAt: string;
};

export type CreateAlarmConfigInput = {
  id: string;
  serverId?: number;
  label?: string;
  timeOfDay: string;
  timezone?: string;
  enabled?: boolean;
  targetCount?: number;
  exerciseType?: ExerciseType;
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateAlarmConfigInput = {
  serverId?: number;
  label?: string;
  timeOfDay?: string;
  timezone?: string;
  enabled?: boolean;
  targetCount?: number;
  exerciseType?: ExerciseType;
  updatedAt?: string;
};
