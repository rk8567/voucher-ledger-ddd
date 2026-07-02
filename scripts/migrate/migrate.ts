#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createPool, queryCount, runSchemaMigrations, runSqlFile, withTransaction } from './db.js';
import { importLedgerHtml, importMasterHtml } from './import-html.js';
import type { MasterImportTarget } from './field-mapping.js';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');
const TRANSFORM_SQL = join(MIGRATIONS_DIR, '005_transform_staging_to_ledger.sql');

type Command = 'schema' | 'import-masters' | 'import-ledger' | 'transform' | 'all' | 'status';

function usage(): never {
  console.error(`Usage:
  npm run migrate -- schema
  npm run migrate -- import-masters --branches filemaker/exports/M拠点L.htm [--entry-types ...] [--transaction-categories ...] [--red-voucher-statuses ...] [--employees ...]
  npm run migrate -- import-ledger --file filemaker/exports/L_T金券管理台帳.htm
  npm run migrate -- import-ledger --file "filemaker/exports/L_T金券管理台帳_*.htm"
  npm run migrate -- transform
  npm run migrate -- all --ledger filemaker/exports/L_T金券管理台帳.htm [--branches ...] [--entry-types ...] [--transaction-categories ...] [--red-voucher-statuses ...] [--employees ...]
  npm run migrate -- all --ledger "filemaker/exports/L_T金券管理台帳_*.htm" [--branches ...]
  npm run migrate -- status

Environment:
  DATABASE_URL  PostgreSQL connection string

Note:
  filemaker/*.xml are DDR schema reports (no row data). Export FileMaker HTML tables from FileMaker Pro, or use the Data API
  (pg_migration account in 各種マスター.fmp12) before running import commands.`);
  process.exit(1);
}

function readArg(flag: string): string | undefined {
  return readArgs(flag)[0];
}

function readArgs(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== flag) continue;
    for (let valueIndex = index + 1; valueIndex < process.argv.length; valueIndex += 1) {
      const value = process.argv[valueIndex];
      if (!value || value.startsWith('--')) break;
      values.push(value);
    }
  }
  return values;
}

function expandFilePatterns(inputs: readonly string[], label: string): string[] {
  if (inputs.length === 0) throw new Error(`${label} requires at least one path or glob`);

  const files = inputs.flatMap((input) => expandFilePattern(input));
  const unique = [...new Set(files)].sort((a, b) => a.localeCompare(b, 'ja'));
  if (unique.length === 0) throw new Error(`${label} did not match any files`);
  return unique;
}

function expandFilePattern(input: string): string[] {
  const absolutePattern = resolve(ROOT, input);
  if (!hasGlob(input)) {
    if (!existsSync(absolutePattern)) throw new Error(`File not found: ${absolutePattern}`);
    if (!statSync(absolutePattern).isFile()) throw new Error(`Not a file: ${absolutePattern}`);
    return [absolutePattern];
  }

  const directory = dirname(absolutePattern);
  const namePattern = basename(absolutePattern);
  if (hasGlob(directory)) {
    throw new Error(`Glob directories are not supported: ${input}`);
  }
  if (!existsSync(directory)) throw new Error(`Directory not found: ${directory}`);

  const regex = globNameRegex(namePattern);
  const matches = readdirSync(directory)
    .filter((name) => regex.test(name))
    .map((name) => join(directory, name))
    .filter((path) => statSync(path).isFile());
  if (matches.length === 0) throw new Error(`No files matched: ${absolutePattern}`);
  return matches;
}

function hasGlob(value: string): boolean {
  return /[*?]/.test(value);
}

function globNameRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regex}$`, 'i');
}

async function runSchema(): Promise<void> {
  const pool = createPool();
  try {
    await runSchemaMigrations(pool, MIGRATIONS_DIR);
    console.log('Schema migrations applied.');
  } finally {
    await pool.end();
  }
}

async function runImportMasters(): Promise<void> {
  const imports: Array<[MasterImportTarget, string | undefined]> = [
    ['branches', readArg('--branches')],
    ['companies', readArg('--companies')],
    ['departments', readArg('--departments')],
    ['employees', readArg('--employees')],
    ['entry_types', readArg('--entry-types')],
    ['transaction_categories', readArg('--transaction-categories')],
    ['red_voucher_statuses', readArg('--red-voucher-statuses')],
  ];

  const selected = imports.filter(([, path]) => path);
  if (selected.length === 0) {
    throw new Error('import-masters requires at least one --branches|--companies|--departments|--employees|--entry-types|--transaction-categories|--red-voucher-statuses HTML export path');
  }

  const pool = createPool();
  try {
    await withTransaction(pool, async (client) => {
      for (const [target, relativePath] of selected) {
        const path = resolve(ROOT, relativePath!);
        if (!existsSync(path)) {
          console.warn(`File not found: ${path}, skipping..`);
          continue;
        }
        const count = await importMasterHtml(client, target, path);
        console.log(`Imported ${count} rows into ${target} from ${relativePath}`);
      }
    });
  } finally {
    await pool.end();
  }
}

async function runImportLedger(fileArgs?: readonly string[]): Promise<void> {
  const filePaths = expandFilePatterns(fileArgs && fileArgs.length > 0 ? fileArgs : readArgs('--file'), 'import-ledger');
  const pool = createPool();
  try {
    let total = 0;
    await withTransaction(pool, async (client) => {
      for (const filePath of filePaths) {
        const inserted = await importLedgerHtml(client, filePath);
        total += inserted;
        console.log(`Loaded ${inserted} ledger rows from ${filePath} into legacy_filemaker_voucher_ledger_staging.`);
      }
    });
    console.log(`Loaded ${total} ledger rows from ${filePaths.length} file(s) into legacy_filemaker_voucher_ledger_staging.`);
  } finally {
    await pool.end();
  }
}

async function runTransform(): Promise<void> {
  if (!existsSync(TRANSFORM_SQL)) throw new Error(`Missing ${TRANSFORM_SQL}`);
  const pool = createPool();
  try {
    const client = await pool.connect();
    try {
      await runSqlFile(client, TRANSFORM_SQL);
    } finally {
      client.release();
    }
    const [staging, entries] = await Promise.all([
      queryCount(pool, 'SELECT count(*)::text AS count FROM legacy_filemaker_voucher_ledger_staging'),
      queryCount(pool, 'SELECT count(*)::text AS count FROM voucher_ledger_entries'),
    ]);
    console.log(`Transform complete. staging=${staging}, voucher_ledger_entries=${entries}`);
  } finally {
    await pool.end();
  }
}

async function runAll(): Promise<void> {
  await runSchema();
  const hasMasters = [
    '--branches',
    '--companies',
    '--departments',
    '--employees',
    '--entry-types',
    '--transaction-categories',
    '--red-voucher-statuses',
  ].some((flag) => readArg(flag));
  if (hasMasters) await runImportMasters();
  const ledgerPaths = [...readArgs('--ledger'), ...readArgs('--file')];
  if (ledgerPaths.length === 0) throw new Error('all requires --ledger <path-or-glob> (ledger HTML export)');
  await runImportLedger(ledgerPaths);
  await runTransform();
}

async function runStatus(): Promise<void> {
  const pool = createPool();
  try {
    const tables = [
      'branches',
      'companies',
      'departments',
      'employees',
      'legacy_filemaker_voucher_ledger_staging',
      'voucher_ledger_entries',
      'voucher_ledger_entry_denominations',
    ];
    for (const table of tables) {
      const count = await queryCount(pool, `SELECT count(*)::text AS count FROM ${table}`);
      console.log(`${table}: ${count}`);
    }
    const [reconciledRows, reconciliationMismatches] = await Promise.all([
      queryCount(
        pool,
        `SELECT count(*)::text AS count
           FROM legacy_filemaker_running_balance_reconciliation
          WHERE legacy_running_total_amount IS NOT NULL`,
      ),
      queryCount(
        pool,
        `SELECT count(*)::text AS count
           FROM legacy_filemaker_running_balance_reconciliation
          WHERE legacy_running_total_amount IS NOT NULL
            AND running_total_matches IS DISTINCT FROM true`,
      ),
    ]);
    console.log(`legacy_running_balance_reconciliation.rows_compared: ${reconciledRows}`);
    console.log(`legacy_running_balance_reconciliation.mismatches: ${reconciliationMismatches}`);
    const legacyImportAuditEvents = await queryCount(
      pool,
      'SELECT count(*)::text AS count FROM legacy_import_audit_log',
    );
    console.log(`legacy_import_audit_log: ${legacyImportAuditEvents}`);
    const auditResult = await pool.query<{
      audit_id: string;
      event_at: Date;
      operation: string;
      legacy_import_enabled: boolean;
      database_user_name: string;
      application_name: string | null;
      detail: unknown;
    }>(
      `SELECT audit_id::text,
              event_at,
              operation,
              legacy_import_enabled,
              database_user_name,
              application_name,
              detail
         FROM legacy_import_audit_log
        ORDER BY audit_id DESC
        LIMIT 5`,
    );
    for (const row of auditResult.rows.reverse()) {
      console.log(
        `legacy_import_audit_log.latest: #${row.audit_id} ${row.event_at.toISOString()} ${row.operation} legacy_import_enabled=${row.legacy_import_enabled} user=${row.database_user_name} app=${row.application_name || '-'} detail=${JSON.stringify(row.detail)}`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command) usage();

  switch (command) {
    case 'schema':
      await runSchema();
      break;
    case 'import-masters':
      await runImportMasters();
      break;
    case 'import-ledger':
      await runImportLedger();
      break;
    case 'transform':
      await runTransform();
      break;
    case 'all':
      await runAll();
      break;
    case 'status':
      await runStatus();
      break;
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
