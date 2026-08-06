import { createPushUpCounter, createSquatCounter, type PoseFrame } from '../exercise/pushupCounter.ts';
import { normalizeTargetCount, DEFAULT_EXERCISE_TYPE, type ExerciseType } from '../alarm/alarm.ts';
import type { ApiWorkoutUpload } from '../workout/types.ts';
import type { ChallengeFlowOptions, ChallengeSnapshot, ChallengeStatus } from './types.ts';

export { type ChallengeFlowOptions, type ChallengeSnapshot, type ChallengeStatus } from './types.ts';

export function createChallengeFlow(options: ChallengeFlowOptions) {
  const alarmId = options.alarmId;
  const targetCount = normalizeTargetCount(options.targetCount);
  const exerciseType = options.exerciseType ?? DEFAULT_EXERCISE_TYPE;
  const counter = exerciseType === 'squat'
    ? createSquatCounter({ targetCount })
    : createPushUpCounter({ targetCount });
  let status: ChallengeStatus = 'idle';
  let count = 0;
  let startedAt = options.startedAt ?? new Date().toISOString();
  const workoutDate = options.workoutDate;
  let workout: ApiWorkoutUpload | null = null;

  function snapshot(): ChallengeSnapshot {
    return {
      status,
      alarmId,
      exerciseType,
      targetCount,
      count,
      workout,
    };
  }

  function complete(completedAt: string): void {
    status = 'completed';
    workout = {
      id: `${alarmId}:${completedAt}`,
      alarmId,
      workoutDate,
      exerciseType,
      targetCount,
      actualCount: count,
      completed: true,
      startedAt,
      completedAt,
    };
  }

  return {
    getSnapshot(): ChallengeSnapshot {
      return snapshot();
    },

    startRinging(at = startedAt): ChallengeSnapshot {
      if (status !== 'completed') {
        status = 'ringing';
        startedAt = at;
      }

      return snapshot();
    },

    beginChallenge(): ChallengeSnapshot {
      if (status !== 'completed') {
        status = 'challenge';
      }

      return snapshot();
    },

    handlePoseFrame(frame: PoseFrame): ChallengeSnapshot {
      if (status !== 'challenge') {
        return snapshot();
      }

      const result = counter.handleFrame(frame);
      count = result.count;

      if (result.isComplete) {
        complete(new Date().toISOString());
      }

      return snapshot();
    },

    /**
     * Reset temporary tracking state when switching cameras.
     * Preserves count so previous reps are not lost.
     */
    resetTrackingStatePreservingCount(): ChallengeSnapshot {
      counter.resetTrackingStatePreservingCount();
      return snapshot();
    },

    reset(): ChallengeSnapshot {
      counter.reset();
      status = 'idle';
      count = 0;
      workout = null;
      return snapshot();
    },
  };
}
