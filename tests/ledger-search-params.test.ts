import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLedgerExportSearchParams, parseLedgerSearchParams } from '../src/app/ledgerSearchParams';

test('ledger search params parse deleted table mode', () => {
  assert.equal(parseLedgerSearchParams({ deleted: '1' }).deletedOnly, true);
  assert.equal(parseLedgerSearchParams({ deleted: '0' }).deletedOnly, false);
});

test('ledger export params preserve deleted table mode', () => {
  const params = new URLSearchParams({ deleted: '1' });

  assert.equal(parseLedgerExportSearchParams(params).deletedOnly, true);
});
