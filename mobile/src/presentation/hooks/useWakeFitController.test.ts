import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatNextFireAtValue,
  buildLocalStreak,
  mergeWorkoutList,
  normalizeTimeOfDayInput,
  computeNextFireAt,
} from './useWakeFitController.ts';
import type { CalendarWorkout, StreakSummary } from '../../application/ports/WakeFitApiClient.ts';

const INITIAL_STREAK: StreakSummary = {
  currentDays: 0,
  longestDays: 0,
  lastCompletedDate: null,
};

describe('useWakeFitController helpers', () => {
  it('formats next fire at as MM-DD HH:mm', () => {
    assert.equal(formatNextFireAtValue('2026-07-27T07:30:00.000Z'), '07-27 07:30');
  });

  it('builds local streak from 1 when lastCompletedDate is null', () => {
    const next = buildLocalStreak(INITIAL_STREAK, '2026-07-27');
    assert.equal(next.currentDays, 1);
    assert.equal(next.longestDays, 1);
    assert.equal(next.lastCompletedDate, '2026-07-27');
  });

  it('keeps streak at 1 for the same workoutDate', () => {
    const streak: StreakSummary = { currentDays: 3, longestDays: 5, lastCompletedDate: '2026-07-25' };
    const next = buildLocalStreak(streak, '2026-07-25');
    assert.deepEqual(next, streak);
  });

  it('increments streak for a consecutive workoutDate', () => {
    const streak: StreakSummary = { currentDays: 3, longestDays: 5, lastCompletedDate: '2026-07-25' };
    const next = buildLocalStreak(streak, '2026-07-26');
    assert.equal(next.currentDays, 4);
    assert.equal(next.longestDays, 5);
  });

  it('resets streak to 1 when workoutDate breaks the consecutive chain', () => {
    const streak: StreakSummary = { currentDays: 3, longestDays: 5, lastCompletedDate: '2026-07-25' };
    const next = buildLocalStreak(streak, '2026-07-28');
    assert.equal(next.currentDays, 1);
    assert.equal(next.longestDays, 5);
  });

  it('merges a workout with the latest entry first', () => {
    const base: CalendarWorkout = {
      id: 1,
      alarmId: 1,
      workoutDate: '2026-07-25',
      exerciseType: 'squat',
      targetCount: 5,
      actualCount: 5,
      completed: true,
    };
    const newer: CalendarWorkout = { ...base, id: 2, workoutDate: '2026-07-27' };
    const result = mergeWorkoutList(newer, [base]);
    assert.equal(result[0].id, 2);
    assert.equal(result[1].id, 1);
  });

  it('replaces an existing entry with the same alarmId and workoutDate', () => {
    const existing: CalendarWorkout = {
      id: 1,
      alarmId: 1,
      workoutDate: '2026-07-25',
      exerciseType: 'squat',
      targetCount: 5,
      actualCount: 3,
      completed: false,
    };
    const replacement: CalendarWorkout = { ...existing, actualCount: 5, completed: true };
    const result = mergeWorkoutList(replacement, [existing]);
    assert.equal(result.length, 1);
    assert.equal(result[0].actualCount, 5);
    assert.equal(result[0].completed, true);
  });

  it('normalizes a valid HH:MM input', () => {
    assert.equal(normalizeTimeOfDayInput('07:30', '08:00'), '07:30');
    assert.equal(normalizeTimeOfDayInput('7:5', '08:00'), '07:05');
  });

  it('falls back when input is invalid', () => {
    assert.equal(normalizeTimeOfDayInput('invalid', '08:00'), '08:00');
    assert.equal(normalizeTimeOfDayInput('25:00', '08:00'), '08:00');
    assert.equal(normalizeTimeOfDayInput('12:60', '08:00'), '08:00');
  });

  it('computes next fire at as an ISO string', () => {
    const result = computeNextFireAt('07:30');
    assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});