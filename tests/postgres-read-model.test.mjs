import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import pg from 'pg';
import connectionString from 'pg-connection-string';

const { Pool } = pg;
const { parse } = connectionString;

const TEST_DATABASE_URL = process.env.VOUCHER_LEDGER_TEST_DATABASE_URL;

function requireTestDatabaseUrl() {
  if (!TEST_DATABASE_URL) {
    throw new Error('VOUCHER_LEDGER_TEST_DATABASE_URL is required for postgres integration tests.');
  }

  const parsed = parse(TEST_DATABASE_URL);
  const databaseName = parsed.database ?? '';
  if (!/test/i.test(databaseName) && process.env.ALLOW_NON_TEST_DATABASE !== '1') {
    throw new Error(
      `Refusing to run postgres tests against non-test database "${databaseName}". Set ALLOW_NON_TEST_DATABASE=1 to override.`,
    );
  }

  return TEST_DATABASE_URL;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function applyMigration(client, schemaName, fileName) {
  await client.query(`SET search_path TO ${schemaName}, public`);
  const sql = readFileSync(join('db', 'migrations', fileName), 'utf8');
  await client.query(sql);
}

async function setupDatabase(t) {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl() });
  const schemaName = `voucher_ledger_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const quotedSchema = quoteIdentifier(schemaName);
  const client = await pool.connect();

  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  t.after(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    } finally {
      client.release();
      await pool.end();
    }
  });

  for (const fileName of ['001_schema.sql', '002_seed_legacy_codes.sql', '003_views.sql']) {
    await applyMigration(client, quotedSchema, fileName);
  }

  return { client, schemaName: quotedSchema };
}

async function insertPostedEntry(client, input) {
  const result = await client.query(
    `INSERT INTO voucher_ledger_entries (
       ledger_no,
       branch_code,
       processing_date,
       daily_sequence,
       entry_type_code,
       description,
       other_amount
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      input.ledgerNo,
      input.branchCode,
      input.processingDate,
      input.dailySequence,
      input.entryTypeCode,
      input.description,
      input.otherAmount ?? 0,
    ],
  );

  const entryId = result.rows[0].id;
  for (const [denominationYen, quantity] of Object.entries(input.quantities ?? {})) {
    await client.query(
      `INSERT INTO voucher_ledger_entry_denominations (entry_id, denomination_yen, quantity)
       VALUES ($1,$2,$3)`,
      [entryId, Number(denominationYen), quantity],
    );
  }

  await client.query(`UPDATE voucher_ledger_entries SET posted_at = now() WHERE id = $1`, [entryId]);

  return entryId;
}

test('postgres read models use processing date, daily sequence, ledger number order', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);

  await insertPostedEntry(client, {
    ledgerNo: 10,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 99,
    description: 'opening',
    otherAmount: 1000,
  });
  await insertPostedEntry(client, {
    ledgerNo: 30,
    branchCode: 1,
    processingDate: '2026-01-03',
    dailySequence: 1,
    entryTypeCode: 2,
    description: 'later incoming',
    otherAmount: 300,
  });
  await insertPostedEntry(client, {
    ledgerNo: 20,
    branchCode: 1,
    processingDate: '2026-01-02',
    dailySequence: 1,
    entryTypeCode: 3,
    description: 'middle outgoing',
    otherAmount: 200,
  });

  const balances = await client.query(
    `SELECT ledger_no, running_total_amount::text AS running_total_amount
       FROM voucher_ledger_running_amounts
      WHERE branch_code = 1
      ORDER BY processing_date, daily_sequence, ledger_no`,
  );

  assert.deepEqual(
    balances.rows.map((row) => [Number(row.ledger_no), Number(row.running_total_amount)]),
    [
      [10, 1000],
      [20, 800],
      [30, 1100],
    ],
  );
});

test('posted financial fields are immutable outside legacy import mode', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);
  const entryId = await insertPostedEntry(client, {
    ledgerNo: 10,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 99,
    description: 'opening',
    otherAmount: 1000,
  });

  await assert.rejects(
    client.query(`UPDATE voucher_ledger_entries SET other_amount = 999 WHERE id = $1`, [entryId]),
    /Posted voucher ledger entries are immutable/,
  );
});
