import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizePermissionStatus } from './createPermissionService.ts';
import type { PermissionStatus } from '../../application/ports/PermissionService.ts';

describe('PermissionStatus contract', () => {
  const VALID_STATUSES = new Set<PermissionStatus>(['granted', 'denied', 'blocked', 'not_determined', 'unavailable']);

  it('only allows the five canonical PermissionStatus values', () => {
    for (const status of ['granted', 'denied', 'blocked', 'not_determined', 'unavailable']) {
      assert.ok(VALID_STATUSES.has(status as PermissionStatus));
    }
    for (const status of ['', 'GRANTED', 'yes', 'unknown', 'invalid']) {
      assert.ok(!VALID_STATUSES.has(status as PermissionStatus));
    }
  });

  it('normalizePermissionStatus returns the value when valid', () => {
    assert.equal(normalizePermissionStatus('granted'), 'granted');
    assert.equal(normalizePermissionStatus('denied'), 'denied');
    assert.equal(normalizePermissionStatus('blocked'), 'blocked');
    assert.equal(normalizePermissionStatus('not_determined'), 'not_determined');
    assert.equal(normalizePermissionStatus('unavailable'), 'unavailable');
  });

  it('normalizePermissionStatus returns unavailable for invalid inputs', () => {
    assert.equal(normalizePermissionStatus(null), 'unavailable');
    assert.equal(normalizePermissionStatus(undefined), 'unavailable');
    assert.equal(normalizePermissionStatus(123), 'unavailable');
    assert.equal(normalizePermissionStatus({}), 'unavailable');
    assert.equal(normalizePermissionStatus('WRONG'), 'unavailable');
  });
});