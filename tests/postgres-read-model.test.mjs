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

  for (const fileName of ['001_schema.sql', '002_seed_legacy_codes.sql', '003_views.sql', '004_legacy_import_staging.sql']) {
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

test('SQL entry totals match domain balance arithmetic', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);
  const quantities = { 84: 3, 10: 2, 600: 1 };
  const otherAmountYen = 125;
  const entryId = await insertPostedEntry(client, {
    ledgerNo: 10,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 99,
    description: 'opening',
    quantities,
    otherAmount: otherAmountYen,
  });
  const domainEquivalentStampAmount = Object.entries(quantities).reduce(
    (sum, [denomination, quantity]) => sum + Number(denomination) * quantity,
    0,
  );
  const domainEquivalentTotalAmount = domainEquivalentStampAmount + otherAmountYen;

  const sqlTotals = await client.query(
    `SELECT stamp_quantity_total::text,
            stamp_amount_total::text,
            other_amount::text,
            total_amount::text
       FROM voucher_ledger_entry_totals
      WHERE entry_id = $1`,
    [entryId],
  );

  assert.deepEqual(sqlTotals.rows[0], {
    stamp_quantity_total: '6',
    stamp_amount_total: String(domainEquivalentStampAmount),
    other_amount: String(otherAmountYen),
    total_amount: String(domainEquivalentTotalAmount),
  });
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

test('app transaction guard can force legacy import bypass off', async (t) => {
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

  await client.query(`SET voucher_ledger.legacy_import = 'on'`);
  await client.query('BEGIN');
  await client.query(`SET LOCAL voucher_ledger.legacy_import = 'off'`);
  try {
    await assert.rejects(
      client.query(`UPDATE voucher_ledger_entries SET other_amount = 999 WHERE id = $1`, [entryId]),
      /Posted voucher ledger entries are immutable/,
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query(`SET voucher_ledger.legacy_import = 'off'`);
  }
});

test('inventory checks compare actual count against expected pre-check balance', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);
  await insertPostedEntry(client, {
    ledgerNo: 10,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 99,
    description: 'opening',
    quantities: { 84: 10 },
    otherAmount: 100,
  });
  await insertPostedEntry(client, {
    ledgerNo: 20,
    branchCode: 1,
    processingDate: '2026-01-02',
    dailySequence: 1,
    entryTypeCode: 3,
    description: 'usage',
    quantities: { 84: 2 },
    otherAmount: 20,
  });
  const checkEntryId = await insertPostedEntry(client, {
    ledgerNo: 30,
    branchCode: 1,
    processingDate: '2026-01-03',
    dailySequence: 1,
    entryTypeCode: 6,
    description: 'inventory check',
    quantities: { 84: 7 },
    otherAmount: 90,
  });

  const totalResult = await client.query(
    `SELECT actual_total_amount::text,
            expected_total_amount::text,
            discrepancy_amount::text
       FROM voucher_inventory_check_results
      WHERE entry_id = $1`,
    [checkEntryId],
  );
  assert.deepEqual(totalResult.rows[0], {
    actual_total_amount: '678',
    expected_total_amount: '752',
    discrepancy_amount: '-74',
  });

  const denominationResult = await client.query(
    `SELECT actual_quantity::text,
            expected_quantity::text,
            discrepancy_quantity::text
       FROM voucher_inventory_check_denomination_results
      WHERE entry_id = $1
        AND denomination_yen = 84`,
    [checkEntryId],
  );
  assert.deepEqual(denominationResult.rows[0], {
    actual_quantity: '7',
    expected_quantity: '8',
    discrepancy_quantity: '-1',
  });

  const runningAtCheck = await client.query(
    `SELECT running_total_amount::text
       FROM voucher_ledger_running_amounts
      WHERE entry_id = $1`,
    [checkEntryId],
  );
  assert.equal(runningAtCheck.rows[0].running_total_amount, '752');
});

test('legacy transform records legacy import audit events', async (t) => {
  const { client, schemaName } = await setupDatabase(t);

  await applyMigration(client, schemaName, '005_transform_staging_to_ledger.sql');

  const result = await client.query(
    `SELECT operation, legacy_import_enabled
       FROM legacy_import_audit_log
      ORDER BY audit_id`,
  );

  assert.deepEqual(result.rows, [
    { operation: 'transform_started', legacy_import_enabled: true },
    { operation: 'transform_completed', legacy_import_enabled: true },
  ]);
});
