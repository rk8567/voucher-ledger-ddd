import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbClient } from '../src/application/db/postgres';
import { PgVoucherLedgerRepository } from '../src/infrastructure/postgres/PgVoucherLedgerRepository';

test('ledger count fallback keeps filter joins in sync with list query', async () => {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const db = {
    async query(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql, values });
      if (queries.length === 1) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ total_count: '0' }], rowCount: 1 };
    },
  } as unknown as DbClient;

  const repository = new PgVoucherLedgerRepository(db);
  const result = await repository.listLedgerEntries({
    columnFilters: {
      counterpartyBranchName: '東京',
      redVoucherStatusName: '通常',
    },
    limit: 50,
    offset: 100,
  });

  assert.deepEqual(result, { items: [], totalCount: 0 });
  assert.equal(queries.length, 2);

  const countSql = queries[1]?.sql ?? '';
  assert.match(countSql, /LEFT JOIN branches cb ON cb\.branch_code = e\.counterparty_branch_code/);
  assert.match(countSql, /LEFT JOIN red_voucher_statuses rvs ON rvs\.code = e\.red_voucher_status_code/);
  assert.match(countSql, /cb\.branch_name ILIKE/);
  assert.match(countSql, /rvs\.name_japanese ILIKE/);
});

test('list-backed text filters match exact option labels', async () => {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const db = {
    async query(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbClient;

  const repository = new PgVoucherLedgerRepository(db);
  await repository.listLedgerEntries({
    columnFilters: {
      responsibleEmployeeName: '山田',
      description: '金',
    },
    limit: 50,
    offset: 0,
  });

  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0]?.values.slice(0, 2), ['山田', '%金%']);
  assert.match(queries[0]?.sql ?? '', /responsible\.employee_name ILIKE \$1/);
  assert.match(queries[0]?.sql ?? '', /e\.description ILIKE \$2/);
});
