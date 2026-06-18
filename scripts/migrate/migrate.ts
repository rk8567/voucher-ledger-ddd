#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  npm run migrate -- transform
  npm run migrate -- all --ledger filemaker/exports/L_T金券管理台帳.htm [--branches ...] [--entry-types ...] [--transaction-categories ...] [--red-voucher-statuses ...] [--employees ...]
  npm run migrate -- status

Environment:
  DATABASE_URL  PostgreSQL connection string

Note:
  filemaker/*.xml are DDR schema reports (no row data). Export FileMaker HTML tables from FileMaker Pro, or use the Data API
  (pg_migration account in 各種マスター.fmp12) before running import commands.`);
  process.exit(1);
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function requireFile(flag: string, label: string): string {
  const value = readArg(flag);
  if (!value) throw new Error(`${label} requires ${flag} <path>`);
  const path = resolve(ROOT, value);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  return path;
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

async function runImportLedger(fileArg?: string): Promise<void> {
  const filePath = fileArg
    ? resolve(ROOT, fileArg)
    : requireFile('--file', 'import-ledger');
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const pool = createPool();
  try {
    const inserted = await withTransaction(pool, (client) => importLedgerHtml(client, filePath));
    console.log(`Loaded ${inserted} ledger rows into legacy_filemaker_voucher_ledger_staging.`);
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
  const ledgerPath = readArg('--ledger') ?? readArg('--file');
  if (!ledgerPath) throw new Error('all requires --ledger <path> (ledger HTML export)');
  await runImportLedger(ledgerPath);
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
