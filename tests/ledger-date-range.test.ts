import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultProcessingDateRange, todayInTokyo } from '../src/application/ledgerDateRange';

test('default processing date range is one month through today in Tokyo', () => {
  const now = new Date('2026-07-07T03:00:00.000Z');

  assert.deepEqual(defaultProcessingDateRange(now), {
    from: '2026-06-07',
    to: '2026-07-07',
  });
});

test('default processing date range clamps month-end days', () => {
  const now = new Date('2026-03-31T03:00:00.000Z');

  assert.deepEqual(defaultProcessingDateRange(now), {
    from: '2026-02-28',
    to: '2026-03-31',
  });
});

test('todayInTokyo uses the Tokyo calendar date', () => {
  const beforeTokyoMidnightInUtc = new Date('2026-07-06T15:30:00.000Z');

  assert.equal(todayInTokyo(beforeTokyoMidnightInUtc), '2026-07-07');
});
