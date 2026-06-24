import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDifference, Balance } from '../src/domain/balance';
import { DomainError } from '../src/domain/errors';
import { DENOMINATIONS, normalizeQuantities, stampAmountYen } from '../src/domain/denominations';
import { EntryTypeCode, assertPostableEntryType, signOfEntryType } from '../src/domain/entryTypes';

test('locks the FileMaker quantity repetition to denomination mapping', () => {
  assert.deepEqual(DENOMINATIONS, [
    1, 2, 10, 50, 84, 94, 120, 140, 210, 5, 20, 52, 110, 270, 430, 600,
  ]);
});

test('computes stamp and total amount in integer yen', () => {
  const balance = Balance.from({
    quantities: {
      84: 2,
      10: 3,
      600: 1,
    },
    otherAmountYen: 250,
  });

  assert.equal(balance.stampAmountYen(), 798);
  assert.equal(balance.totalAmountYen(), 1048);
  assert.deepEqual(balance.toSnapshot(), {
    quantities: {
      10: 3,
      84: 2,
      600: 1,
    },
    otherAmountYen: 250,
    stampAmountYen: 798,
    totalAmountYen: 1048,
  });
});

test('rejects unknown denominations and negative quantities', () => {
  assert.throws(
    () => normalizeQuantities({ 999: 1 }),
    (error) => error instanceof DomainError && error.code === 'INVALID_DENOMINATION',
  );

  assert.throws(
    () => normalizeQuantities({ 84: -1 }),
    (error) => error instanceof DomainError && error.code === 'INVALID_QUANTITY',
  );
});

test('calculates actual minus expected balance differences', () => {
  const expected = Balance.from({ quantities: { 84: 2, 10: 1 }, otherAmountYen: 100 }).toSnapshot();
  const actual = Balance.from({ quantities: { 84: 1, 10: 4 }, otherAmountYen: 150 }).toSnapshot();

  assert.deepEqual(calculateDifference(actual, expected), {
    quantities: {
      10: 3,
      84: -1,
    },
    otherAmountYen: 50,
    stampAmountYen: -54,
    totalAmountYen: -4,
  });
});

test('stampAmountYen sums normalized quantities', () => {
  assert.equal(stampAmountYen(normalizeQuantities({ 1: 5, 270: 2 })), 545);
});

test('legacy carry rows are display-only and not postable', () => {
  assert.equal(signOfEntryType(EntryTypeCode.CarryIn), 0);
  assert.equal(signOfEntryType(EntryTypeCode.CarryOut), 0);

  assert.throws(
    () => assertPostableEntryType(EntryTypeCode.CarryIn),
    (error) => error instanceof DomainError && error.code === 'INVALID_ENTRY_TYPE',
  );
  assert.throws(
    () => assertPostableEntryType(EntryTypeCode.CarryOut),
    (error) => error instanceof DomainError && error.code === 'INVALID_ENTRY_TYPE',
  );
});
