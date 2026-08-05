import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildWakeFitTabs } from './buildWakeFitTabs.ts';

describe('buildWakeFitTabs', () => {
  it('returns home, alarm, history, backend tabs in debug builds', () => {
    const tabs = buildWakeFitTabs(true);
    assert.deepEqual(tabs.map((t) => t.key), ['home', 'alarm', 'history', 'backend']);
    assert.equal(tabs.find((t) => t.key === 'backend')?.debugOnly, true);
  });

  it('returns only home, alarm, history tabs in release builds', () => {
    const tabs = buildWakeFitTabs(false);
    assert.deepEqual(tabs.map((t) => t.key), ['home', 'alarm', 'history']);
    assert.equal(tabs.some((t) => t.key === 'backend'), false);
  });
});