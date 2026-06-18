import type { PoolClient } from 'pg';
import {
  asNullableBigInt,
  asNullableBoolean,
  asNullableDate,
  asNullableInt,
  asNullableTimestamp,
  asRequiredInt,
  mapRow,
  readCsvFile,
  readCsvRowsFile,
} from './csv.js';
import {
  LEDGER_CSV_COLUMNS,
  LEDGER_QUANTITY_COLUMNS,
  MASTER_COLUMN_MAP,
  type MasterImportTarget,
} from './field-mapping.js';

const STAGING_INSERT = `
INSERT INTO legacy_filemaker_voucher_ledger_staging (
  source_file,
  raw_record,
  legacy_uuid,
  ledger_no,
  department_code,
  branch_code,
  period_year,
  period_month,
  application_date,
  processing_date,
  daily_sequence,
  entry_type_code,
  transaction_category_code,
  counterparty_branch_code,
  status_code,
  description,
  responsible_employee_no,
  company_code,
  other_amount,
  other_amount_note,
  remarks,
  is_deleted,
  red_voucher_status_code,
  original_ledger_no,
  reversal_ledger_no,
  correction_ledger_no,
  registered_at,
  registered_by_employee_no,
  updated_at,
  updated_by_employee_no,
  filemaker_created_at,
  filemaker_created_by,
  filemaker_modified_at,
  filemaker_modified_by,
  quantity_rep_01,
  quantity_rep_02,
  quantity_rep_03,
  quantity_rep_04,
  quantity_rep_05,
  quantity_rep_06,
  quantity_rep_07,
  quantity_rep_08,
  quantity_rep_09,
  quantity_rep_10,
  quantity_rep_11,
  quantity_rep_12,
  quantity_rep_13,
  quantity_rep_14,
  quantity_rep_15,
  quantity_rep_16
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50
)
ON CONFLICT (ledger_no) DO NOTHING
`;

export async function importLedgerCsv(client: PoolClient, filePath: string): Promise<number> {
  const rawRows = readCsvRowsFile(filePath);
  if (rawRows.length > 0 && !rawRows[0]!.includes('出納No')) {
    return importHeaderlessRawLedgerCsv(client, filePath, rawRows);
  }

  const rows = readCsvFile(filePath);
  let inserted = 0;

  for (const row of rows) {
    const mapped = {
      ...mapRow(row, LEDGER_CSV_COLUMNS),
      ...mapRow(row, LEDGER_QUANTITY_COLUMNS),
    };

    const ledgerNo = asNullableInt(mapped.ledger_no);
    if (ledgerNo == null) continue;

    const result = await client.query(STAGING_INSERT, [
      filePath,
      JSON.stringify(row),
      mapped.legacy_uuid || null,
      ledgerNo,
      asNullableInt(mapped.department_code),
      asRequiredInt(mapped.branch_code, 'branch_code'),
      asNullableInt(mapped.period_year),
      asNullableInt(mapped.period_month),
      asNullableDate(mapped.application_date),
      asNullableDate(mapped.processing_date) ?? asNullableDate(mapped.application_date),
      asNullableInt(mapped.daily_sequence) ?? 0,
      asRequiredInt(mapped.entry_type_code, 'entry_type_code'),
      asNullableInt(mapped.transaction_category_code),
      asNullableInt(mapped.counterparty_branch_code),
      asNullableInt(mapped.status_code),
      mapped.description || null,
      asNullableInt(mapped.responsible_employee_no),
      asNullableInt(mapped.company_code),
      asNullableBigInt(mapped.other_amount)?.toString() ?? '0',
      mapped.other_amount_note || null,
      mapped.remarks || null,
      asNullableBoolean(mapped.is_deleted) ?? false,
      asNullableInt(mapped.red_voucher_status_code) ?? 0,
      asNullableInt(mapped.original_ledger_no),
      asNullableInt(mapped.reversal_ledger_no),
      asNullableInt(mapped.correction_ledger_no),
      asNullableTimestamp(mapped.registered_at),
      asNullableInt(mapped.registered_by_employee_no),
      asNullableTimestamp(mapped.updated_at),
      asNullableInt(mapped.updated_by_employee_no),
      asNullableTimestamp(mapped.filemaker_created_at),
      mapped.filemaker_created_by || null,
      asNullableTimestamp(mapped.filemaker_modified_at),
      mapped.filemaker_modified_by || null,
      asNullableInt(mapped.quantity_rep_01),
      asNullableInt(mapped.quantity_rep_02),
      asNullableInt(mapped.quantity_rep_03),
      asNullableInt(mapped.quantity_rep_04),
      asNullableInt(mapped.quantity_rep_05),
      asNullableInt(mapped.quantity_rep_06),
      asNullableInt(mapped.quantity_rep_07),
      asNullableInt(mapped.quantity_rep_08),
      asNullableInt(mapped.quantity_rep_09),
      asNullableInt(mapped.quantity_rep_10),
      asNullableInt(mapped.quantity_rep_11),
      asNullableInt(mapped.quantity_rep_12),
      asNullableInt(mapped.quantity_rep_13),
      asNullableInt(mapped.quantity_rep_14),
      asNullableInt(mapped.quantity_rep_15),
      asNullableInt(mapped.quantity_rep_16),
    ]);

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

async function importHeaderlessRawLedgerCsv(
  client: PoolClient,
  filePath: string,
  rows: string[][],
): Promise<number> {
  let inserted = 0;

  for (const [index, row] of rows.entries()) {
    if (row.length < 69) continue;

    const entryTypeCode = asNullableInt(row[17]);
    const processingDate = asNullableDate(row[18]);
    const branchCode = asNullableInt(row[3]);
    const ledgerNo = asNullableInt(row[19]);
    if (entryTypeCode == null || processingDate == null || branchCode == null || ledgerNo == null) continue;

    const quantities = rawQuantities(row[45]);
    const otherAmount = Math.max(asNullableInt(row[14]) ?? 0, 0);
    const originalLedgerNo = asNullableInt(row[16]);
    const reversalLedgerNo = asNullableInt(row[66]);
    const correctionLedgerNo = asNullableInt(row[65]);

    const result = await client.query(STAGING_INSERT, [
      filePath,
      JSON.stringify({ rowNumber: index + 1, columns: row }),
      null,
      ledgerNo,
      asNullableInt(row[67]),
      branchCode,
      asNullableInt(row[2]),
      asNullableInt(row[5]),
      asNullableDate(row[62]),
      processingDate,
      index + 1,
      entryTypeCode,
      null,
      null,
      null,
      row[42] || row[8] || '(raw legacy import)',
      null,
      null,
      String(otherAmount),
      null,
      row[15] || null,
      asNullableBoolean(row[6]) ?? false,
      rawRedVoucherStatusCode({ originalLedgerNo, reversalLedgerNo }),
      originalLedgerNo,
      reversalLedgerNo,
      correctionLedgerNo,
      asNullableTimestamp(row[63]),
      null,
      asNullableTimestamp(row[44]) ?? asNullableTimestamp(row[63]),
      null,
      null,
      null,
      null,
      null,
      ...quantities,
    ]);

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

function rawRedVoucherStatusCode(input: { originalLedgerNo: number | null; reversalLedgerNo: number | null }): 0 | 1 | 2 | 3 {
  if (input.originalLedgerNo == null && input.reversalLedgerNo != null) return 1;
  if (input.originalLedgerNo != null && input.reversalLedgerNo != null) return 3;
  if (input.originalLedgerNo != null) return 2;
  return 0;
}

function rawQuantities(value: string | undefined): number[] {
  const parts = (value ?? '').split('\x1d');
  return Array.from({ length: 16 }, (_, index) => {
    const parsed = asNullableInt(parts[index]);
    return parsed ?? 0;
  });
}

async function upsertBranches(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  await client.query(
    `INSERT INTO branches (
      branch_code, branch_name, abbreviation, active, opening_balance_amount_legacy, notes, legacy_uuid
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (branch_code) DO UPDATE SET
      branch_name = EXCLUDED.branch_name,
      abbreviation = COALESCE(EXCLUDED.abbreviation, branches.abbreviation),
      active = EXCLUDED.active,
      opening_balance_amount_legacy = COALESCE(EXCLUDED.opening_balance_amount_legacy, branches.opening_balance_amount_legacy),
      notes = COALESCE(EXCLUDED.notes, branches.notes),
      legacy_uuid = COALESCE(EXCLUDED.legacy_uuid, branches.legacy_uuid),
      updated_at = now()`,
    [
      asRequiredInt(mapped.branch_code, 'branch_code'),
      mapped.branch_name || `Branch ${mapped.branch_code}`,
      mapped.abbreviation || null,
      asNullableBoolean(mapped.active) ?? false,
      asNullableBigInt(mapped.opening_balance_amount_legacy)?.toString() ?? null,
      mapped.notes || null,
      mapped.legacy_uuid || null,
    ],
  );
}

async function upsertCompanies(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  await client.query(
    `INSERT INTO companies (company_code, company_name, official_name, abbreviation, legacy_uuid)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (company_code) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       official_name = COALESCE(EXCLUDED.official_name, companies.official_name),
       abbreviation = COALESCE(EXCLUDED.abbreviation, companies.abbreviation),
       legacy_uuid = COALESCE(EXCLUDED.legacy_uuid, companies.legacy_uuid),
       updated_at = now()`,
    [
      asRequiredInt(mapped.company_code, 'company_code'),
      mapped.company_name || `Company ${mapped.company_code}`,
      mapped.official_name || null,
      mapped.abbreviation || null,
      mapped.legacy_uuid || null,
    ],
  );
}

async function upsertDepartments(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  await client.query(
    `INSERT INTO departments (department_code, department_name, legacy_uuid)
     VALUES ($1,$2,$3)
     ON CONFLICT (department_code) DO UPDATE SET
       department_name = EXCLUDED.department_name,
       legacy_uuid = COALESCE(EXCLUDED.legacy_uuid, departments.legacy_uuid),
       updated_at = now()`,
    [
      asRequiredInt(mapped.department_code, 'department_code'),
      mapped.department_name || `Department ${mapped.department_code}`,
      mapped.legacy_uuid || null,
    ],
  );
}

async function upsertEmployees(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  const retiredOn = asNullableDate(mapped.retired_on);
  await client.query(
    `INSERT INTO employees (
      employee_no, employee_name, company_code, department_code, branch_code,
      account_name, is_approver, is_admin, active, retired_on, legacy_uuid
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (employee_no) DO UPDATE SET
      employee_name = EXCLUDED.employee_name,
      company_code = COALESCE(EXCLUDED.company_code, employees.company_code),
      department_code = COALESCE(EXCLUDED.department_code, employees.department_code),
      branch_code = COALESCE(EXCLUDED.branch_code, employees.branch_code),
      account_name = COALESCE(EXCLUDED.account_name, employees.account_name),
      is_approver = EXCLUDED.is_approver,
      is_admin = EXCLUDED.is_admin,
      active = EXCLUDED.active,
      retired_on = COALESCE(EXCLUDED.retired_on, employees.retired_on),
      legacy_uuid = COALESCE(EXCLUDED.legacy_uuid, employees.legacy_uuid),
      updated_at = now()`,
    [
      asRequiredInt(mapped.employee_no, 'employee_no'),
      mapped.employee_name || `Employee ${mapped.employee_no}`,
      asNullableInt(mapped.company_code),
      asNullableInt(mapped.department_code),
      asNullableInt(mapped.branch_code),
      mapped.account_name || null,
      asNullableBoolean(mapped.is_approver) ?? false,
      asNullableBoolean(mapped.is_admin) ?? false,
      retiredOn ? false : true,
      retiredOn,
      mapped.legacy_uuid || null,
    ],
  );
}

async function upsertEntryTypes(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  const code = asRequiredInt(mapped.code, 'code');
  const defaults = inferEntryTypeDefaults(code);
  await client.query(
    `INSERT INTO entry_types (
       code, name_japanese, abbreviation, effect, requires_nonzero_amount, is_legacy_carry
     )
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (code) DO UPDATE SET
       name_japanese = EXCLUDED.name_japanese,
       abbreviation = COALESCE(EXCLUDED.abbreviation, entry_types.abbreviation)`,
    [
      code,
      mapped.name_japanese || `Entry type ${code}`,
      mapped.abbreviation || null,
      defaults.effect,
      defaults.requiresNonzeroAmount,
      defaults.isLegacyCarry,
    ],
  );
}

async function upsertTransactionCategories(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  const code = asRequiredInt(mapped.code, 'code');
  await client.query(
    `INSERT INTO transaction_categories (
       code, name_japanese, abbreviation, requires_counterparty_branch, selectable
     )
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (code) DO UPDATE SET
       name_japanese = EXCLUDED.name_japanese,
       abbreviation = COALESCE(EXCLUDED.abbreviation, transaction_categories.abbreviation),
       selectable = EXCLUDED.selectable`,
    [
      code,
      mapped.name_japanese || `Category ${code}`,
      mapped.abbreviation || null,
      code === 1,
      asNullableBoolean(mapped.selectable) ?? true,
    ],
  );
}

async function upsertRedVoucherStatuses(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  const code = asRequiredInt(mapped.code, 'code');
  await client.query(
    `INSERT INTO red_voucher_statuses (code, name_japanese, abbreviation)
     VALUES ($1,$2,$3)
     ON CONFLICT (code) DO UPDATE SET
       name_japanese = EXCLUDED.name_japanese,
       abbreviation = COALESCE(EXCLUDED.abbreviation, red_voucher_statuses.abbreviation)`,
    [code, mapped.name_japanese || `Red voucher ${code}`, mapped.abbreviation || null],
  );
}

const MASTER_UPSERT: Record<MasterImportTarget, (client: PoolClient, mapped: Record<string, string>) => Promise<void>> = {
  branches: upsertBranches,
  companies: upsertCompanies,
  departments: upsertDepartments,
  employees: upsertEmployees,
  entry_types: upsertEntryTypes,
  transaction_categories: upsertTransactionCategories,
  red_voucher_statuses: upsertRedVoucherStatuses,
};

function inferEntryTypeDefaults(code: number): {
  effect: 'opening_balance' | 'incoming' | 'outgoing' | 'inventory_check' | 'non_posting';
  requiresNonzeroAmount: boolean;
  isLegacyCarry: boolean;
} {
  switch (code) {
    case 2:
    case 4:
      return { effect: 'incoming', requiresNonzeroAmount: true, isLegacyCarry: false };
    case 3:
    case 5:
      return { effect: 'outgoing', requiresNonzeroAmount: true, isLegacyCarry: false };
    case 6:
      return { effect: 'inventory_check', requiresNonzeroAmount: true, isLegacyCarry: false };
    case 99:
      return { effect: 'opening_balance', requiresNonzeroAmount: true, isLegacyCarry: false };
    case 1:
    case 9:
    default:
      return { effect: 'non_posting', requiresNonzeroAmount: false, isLegacyCarry: code === 1 || code === 9 };
  }
}

export async function importMasterCsv(
  client: PoolClient,
  target: MasterImportTarget,
  filePath: string,
): Promise<number> {
  const rows = readCsvFile(filePath);
  const columnMap = MASTER_COLUMN_MAP[target];
  const upsert = MASTER_UPSERT[target];
  let count = 0;

  for (const row of rows) {
    const mapped = mapRow(row, columnMap);
    await upsert(client, mapped);
    count += 1;
  }

  return count;
}
