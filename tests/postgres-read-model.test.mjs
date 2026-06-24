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

test('legacy reconciliation uses FileMaker sequence and includes deleted rows', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);

  await insertPostedEntry(client, {
    ledgerNo: 1,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 99,
    description: 'opening',
    otherAmount: 1000,
  });
  await insertPostedEntry(client, {
    ledgerNo: 2,
    branchCode: 1,
    processingDate: '2026-01-02',
    dailySequence: 2,
    entryTypeCode: 3,
    description: 'usage',
    otherAmount: 100,
  });
  await insertPostedEntry(client, {
    ledgerNo: 7,
    branchCode: 1,
    processingDate: '2025-12-31',
    dailySequence: 3,
    entryTypeCode: 99,
    description: 'late legacy opening balance',
    otherAmount: 200,
  });
  const deletedEntryId = await insertPostedEntry(client, {
    ledgerNo: 32,
    branchCode: 1,
    processingDate: '2026-01-03',
    dailySequence: 4,
    entryTypeCode: 3,
    description: 'deleted legacy usage',
    otherAmount: 40,
  });
  await client.query(`UPDATE voucher_ledger_entries SET is_deleted = true WHERE id = $1`, [deletedEntryId]);
  await insertPostedEntry(client, {
    ledgerNo: 33,
    branchCode: 1,
    processingDate: '2026-01-04',
    dailySequence: 5,
    entryTypeCode: 3,
    description: 'usage after deleted row',
    otherAmount: 60,
  });

  await client.query(
    `INSERT INTO legacy_filemaker_voucher_ledger_staging (
       ledger_no,
       branch_code,
       processing_date,
       daily_sequence,
       entry_type_code,
       legacy_running_total_amount
     ) VALUES
       (1, 1, '2026-01-01', 1, 99, 1000),
       (2, 1, '2026-01-02', 2, 3, 900),
       (7, 1, '2025-12-31', 3, 99, 1100),
       (32, 1, '2026-01-03', 4, 3, 1060),
       (33, 1, '2026-01-04', 5, 3, 1000)`,
  );

  const appBalanceForDeletedRow = await client.query(
    `SELECT ledger_no, running_total_amount::text
       FROM voucher_ledger_running_amounts
      WHERE ledger_no IN (32, 33)
      ORDER BY ledger_no`,
  );
  assert.deepEqual(appBalanceForDeletedRow.rows, [{ ledger_no: '33', running_total_amount: '1040' }]);

  const reconciliation = await client.query(
    `SELECT ledger_no,
            computed_running_total_amount::text,
            running_total_matches
       FROM legacy_filemaker_running_balance_reconciliation
      ORDER BY daily_sequence, ledger_no`,
  );

  assert.deepEqual(reconciliation.rows, [
    { ledger_no: '1', computed_running_total_amount: '1000', running_total_matches: true },
    { ledger_no: '2', computed_running_total_amount: '900', running_total_matches: true },
    { ledger_no: '7', computed_running_total_amount: '1100', running_total_matches: true },
    { ledger_no: '32', computed_running_total_amount: '1060', running_total_matches: true },
    { ledger_no: '33', computed_running_total_amount: '1000', running_total_matches: true },
  ]);
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

test('SQL running totals match independent balance arithmetic', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);
  const entries = [
    {
      ledgerNo: 10,
      processingDate: '2026-01-01',
      dailySequence: 1,
      entryTypeCode: 99,
      description: 'opening',
      quantities: { 84: 5, 10: 2 },
      otherAmount: 100,
      sign: 1,
    },
    {
      ledgerNo: 30,
      processingDate: '2026-01-03',
      dailySequence: 1,
      entryTypeCode: 2,
      description: 'incoming',
      quantities: { 84: 1 },
      otherAmount: 20,
      sign: 1,
    },
    {
      ledgerNo: 20,
      processingDate: '2026-01-02',
      dailySequence: 1,
      entryTypeCode: 3,
      description: 'outgoing',
      quantities: { 10: 1 },
      otherAmount: 50,
      sign: -1,
    },
  ];

  for (const entry of entries) {
    await insertPostedEntry(client, {
      ledgerNo: entry.ledgerNo,
      branchCode: 1,
      processingDate: entry.processingDate,
      dailySequence: entry.dailySequence,
      entryTypeCode: entry.entryTypeCode,
      description: entry.description,
      quantities: entry.quantities,
      otherAmount: entry.otherAmount,
    });
  }

  let runningStampAmount = 0;
  let runningOtherAmount = 0;
  const expectedRows = entries
    .toSorted((a, b) => a.processingDate.localeCompare(b.processingDate) || a.dailySequence - b.dailySequence || a.ledgerNo - b.ledgerNo)
    .map((entry) => {
      const stampAmount = Object.entries(entry.quantities).reduce(
        (sum, [denomination, quantity]) => sum + Number(denomination) * quantity,
        0,
      );
      runningStampAmount += entry.sign * stampAmount;
      runningOtherAmount += entry.sign * entry.otherAmount;
      return [
        entry.ledgerNo,
        runningStampAmount,
        runningOtherAmount,
        runningStampAmount + runningOtherAmount,
      ];
    });

  const sqlRows = await client.query(
    `SELECT ledger_no,
            running_stamp_amount::text,
            running_other_amount::text,
            running_total_amount::text
       FROM voucher_ledger_running_amounts
      WHERE branch_code = 1
      ORDER BY processing_date, daily_sequence, ledger_no`,
  );

  assert.deepEqual(
    sqlRows.rows.map((row) => [
      Number(row.ledger_no),
      Number(row.running_stamp_amount),
      Number(row.running_other_amount),
      Number(row.running_total_amount),
    ]),
    expectedRows,
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

test('red-voucher database rules reject invalid status/link combinations', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);
  await insertPostedEntry(client, {
    ledgerNo: 1,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 99,
    description: 'opening',
    otherAmount: 1000,
  });
  await insertPostedEntry(client, {
    ledgerNo: 10,
    branchCode: 1,
    processingDate: '2026-01-01',
    dailySequence: 1,
    entryTypeCode: 2,
    description: 'original movement',
    otherAmount: 100,
  });

  await assert.rejects(
    client.query(
      `INSERT INTO voucher_ledger_entries (
         ledger_no,
         branch_code,
         processing_date,
         daily_sequence,
         entry_type_code,
         description,
         red_voucher_status_code,
         original_ledger_no
       ) VALUES (20, 1, '2026-01-02', 1, 3, 'invalid normal link', 0, 10)`,
    ),
    /Normal rows must not have original_ledger_no/,
  );

  await assert.rejects(
    client.query(
      `INSERT INTO voucher_ledger_entries (
         ledger_no,
         branch_code,
         processing_date,
         daily_sequence,
         entry_type_code,
         description,
         red_voucher_status_code
       ) VALUES (21, 1, '2026-01-02', 1, 3, 'invalid red without original', 2)`,
    ),
    /赤伝票 \/ 訂正伝票 rows must have original_ledger_no/,
  );
});

test('red-voucher database links reject orphan ledger numbers at commit', async (t) => {
  const { client } = await setupDatabase(t);

  await client.query(`INSERT INTO branches (branch_code, branch_name) VALUES (1, 'Test branch')`);
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO voucher_ledger_entries (
         ledger_no,
         branch_code,
         processing_date,
         daily_sequence,
         entry_type_code,
         description,
         red_voucher_status_code,
         original_ledger_no
       ) VALUES (20, 1, '2026-01-02', 1, 3, 'orphan red link', 2, 9999)`,
    );

    await assert.rejects(
      client.query('COMMIT'),
      /voucher_ledger_entries_original_ledger_no_fkey/,
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
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
