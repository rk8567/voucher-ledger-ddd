import type { PoolClient } from 'pg';
import { readHtmlTableFile, type HtmlTableRow } from './html.js';
import {
  MASTER_COLUMN_MAP,
  type MasterImportTarget,
} from './field-mapping.js';

const STAGING_INSERT = `
INSERT INTO legacy_filemaker_voucher_ledger_staging (
  source_file,
  raw_record,
  filemaker_login_employee_no,
  filemaker_login_employee_name,
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
  legacy_stamp_amount_total,
  legacy_total_amount,
  legacy_running_total_amount,
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
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55
)
ON CONFLICT (ledger_no) DO UPDATE SET
  source_file = EXCLUDED.source_file,
  raw_record = EXCLUDED.raw_record,
  filemaker_login_employee_no = EXCLUDED.filemaker_login_employee_no,
  filemaker_login_employee_name = EXCLUDED.filemaker_login_employee_name,
  legacy_uuid = COALESCE(EXCLUDED.legacy_uuid, legacy_filemaker_voucher_ledger_staging.legacy_uuid),
  department_code = EXCLUDED.department_code,
  branch_code = EXCLUDED.branch_code,
  period_year = EXCLUDED.period_year,
  period_month = EXCLUDED.period_month,
  application_date = EXCLUDED.application_date,
  processing_date = EXCLUDED.processing_date,
  daily_sequence = EXCLUDED.daily_sequence,
  entry_type_code = EXCLUDED.entry_type_code,
  transaction_category_code = EXCLUDED.transaction_category_code,
  counterparty_branch_code = EXCLUDED.counterparty_branch_code,
  status_code = EXCLUDED.status_code,
  description = EXCLUDED.description,
  responsible_employee_no = EXCLUDED.responsible_employee_no,
  company_code = EXCLUDED.company_code,
  other_amount = EXCLUDED.other_amount,
  legacy_stamp_amount_total = EXCLUDED.legacy_stamp_amount_total,
  legacy_total_amount = EXCLUDED.legacy_total_amount,
  legacy_running_total_amount = EXCLUDED.legacy_running_total_amount,
  other_amount_note = EXCLUDED.other_amount_note,
  remarks = EXCLUDED.remarks,
  is_deleted = EXCLUDED.is_deleted,
  red_voucher_status_code = EXCLUDED.red_voucher_status_code,
  original_ledger_no = EXCLUDED.original_ledger_no,
  reversal_ledger_no = EXCLUDED.reversal_ledger_no,
  correction_ledger_no = EXCLUDED.correction_ledger_no,
  registered_at = EXCLUDED.registered_at,
  registered_by_employee_no = EXCLUDED.registered_by_employee_no,
  updated_at = EXCLUDED.updated_at,
  updated_by_employee_no = EXCLUDED.updated_by_employee_no,
  filemaker_created_at = EXCLUDED.filemaker_created_at,
  filemaker_created_by = EXCLUDED.filemaker_created_by,
  filemaker_modified_at = EXCLUDED.filemaker_modified_at,
  filemaker_modified_by = EXCLUDED.filemaker_modified_by,
  quantity_rep_01 = EXCLUDED.quantity_rep_01,
  quantity_rep_02 = EXCLUDED.quantity_rep_02,
  quantity_rep_03 = EXCLUDED.quantity_rep_03,
  quantity_rep_04 = EXCLUDED.quantity_rep_04,
  quantity_rep_05 = EXCLUDED.quantity_rep_05,
  quantity_rep_06 = EXCLUDED.quantity_rep_06,
  quantity_rep_07 = EXCLUDED.quantity_rep_07,
  quantity_rep_08 = EXCLUDED.quantity_rep_08,
  quantity_rep_09 = EXCLUDED.quantity_rep_09,
  quantity_rep_10 = EXCLUDED.quantity_rep_10,
  quantity_rep_11 = EXCLUDED.quantity_rep_11,
  quantity_rep_12 = EXCLUDED.quantity_rep_12,
  quantity_rep_13 = EXCLUDED.quantity_rep_13,
  quantity_rep_14 = EXCLUDED.quantity_rep_14,
  quantity_rep_15 = EXCLUDED.quantity_rep_15,
  quantity_rep_16 = EXCLUDED.quantity_rep_16
`;

const LEGACY_DENOMINATIONS_BY_REPETITION = [
  1, 2, 10, 50, 84, 94, 120, 140, 210, 5, 20, 52, 110, 270, 430, 600,
] as const;

type ExistingStagingLedger = {
  ledgerNo: number;
  branchCode: number | null;
  sourceFile: string;
};

type SeenImportLedger = {
  branchCode: number;
  rowNumber: number;
};

function mapRow(row: HtmlTableRow, columnMap: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [source, target] of Object.entries(columnMap)) {
    if (source in row) mapped[target] = row[source] ?? '';
  }
  return mapped;
}

function asNullableInt(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(normalizeIntegerText(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function asRequiredInt(value: string | undefined, field: string): number {
  const parsed = asNullableInt(value);
  if (parsed == null) throw new Error(`${field} is required`);
  return parsed;
}

function asNullableBigInt(value: string | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(normalizeIntegerText(value));
  } catch {
    return null;
  }
}

function normalizeIntegerText(value: string): string {
  const normalized = value.replace(/[,\s円￥¥;；]/g, '').trim();
  return normalized.replace(/\.0*$/, '');
}

function asNullableBoolean(value: string | undefined): boolean | null {
  if (value == null || value === '') return null;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return null;
}

function asNullableDate(value: string | undefined): string | null {
  if (value == null || value === '') return null;
  const slashMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

function asNullableTimestamp(value: string | undefined): string | null {
  if (value == null || value === '') return null;
  const slashMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (slashMatch) {
    const [, year, month, day, hour, minute, second = '00'] = slashMatch;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}T${hour!.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}`;
  }
  const normalized = value.replace(/\//g, '-').replace(' ', 'T');
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export async function importLedgerHtml(client: PoolClient, filePath: string): Promise<number> {
  assertHtmlFile(filePath);
  const resolveEmployeeNo = await loadEmployeeResolver(client);
  return importRawLedgerRows(client, filePath, readHtmlTableFile(filePath), resolveEmployeeNo);
}

function assertHtmlFile(filePath: string): void {
  if (!/\.html?$/i.test(filePath)) {
    throw new Error(`Only FileMaker HTML table exports are supported: ${filePath}`);
  }
}

async function importRawLedgerRows(
  client: PoolClient,
  filePath: string,
  rows: Array<Record<string, string>>,
  resolveEmployeeNo: (name: string | undefined, branchCode: number) => number | null,
): Promise<number> {
  let inserted = 0;
  const skippedRows: string[] = [];
  const existingLedgerNos = await loadExistingStagingLedgerNos(client);
  const seenLedgerNos = new Map<number, SeenImportLedger>();

  for (const [index, row] of rows.entries()) {
    const entryTypeCode = asNullableInt(row.入出区分CD);
    const processingDate = asNullableDate(row.処理日);
    const branchCode = asNullableInt(row.拠点CD);
    const counterpartyBranchCode = normalizedCounterpartyBranchCode(row, branchCode);
    const ledgerNo = asNullableInt(row.出納No);
    if (entryTypeCode == null || processingDate == null || branchCode == null || ledgerNo == null) {
      if (isLegacySummaryOnlyRow(row)) continue;

      skippedRows.push(
        `row ${index + 1}: 出納No=${row.出納No || '(blank)'}, 拠点CD=${row.拠点CD || '(blank)'}, 拠点CD[2]=${row['拠点CD[2]'] || '(blank)'}, 処理日=${row.処理日 || '(blank)'}, 入出区分CD=${row.入出区分CD || '(blank)'}`,
      );
      continue;
    }

    assertLedgerNoImportIsSafe({
      filePath,
      ledgerNo,
      branchCode,
      rowNumber: index + 1,
      existing: existingLedgerNos.get(ledgerNo),
      seen: seenLedgerNos.get(ledgerNo),
    });
    seenLedgerNos.set(ledgerNo, { branchCode, rowNumber: index + 1 });

    const originalLedgerNo = asNullableInt(row.元伝票No);
    const reversalLedgerNo = asNullableInt(row.赤伝票No);
    const correctionLedgerNo = asNullableInt(row.訂正伝票No);
    const responsibleEmployeeNo = asNullableInt(row.担当者CD) ?? resolveEmployeeNo(row.氏名, branchCode);
    const registeredByEmployeeNo = asNullableInt(row.登録担当CD) ?? resolveEmployeeNo(row['氏名[2]'], branchCode);
    const updatedByEmployeeNo = asNullableInt(row.更新担当CD) ?? resolveEmployeeNo(row['氏名[3]'], branchCode);
    const otherAmount = asNullableBigInt(row.その他金額) ?? 0n;
    const quantities = rawQuantitiesFromRow(row);
    validateLegacyRowTotals(row, quantities, otherAmount, index + 1);
    const legacyStampAmountTotal = asNullableBigInt(row.切手金額合計);
    const legacyTotalAmount = asNullableBigInt(row.金額合計);
    const legacyRunningTotalAmount = asNullableBigInt(row.残高合計);

    const result = await client.query(STAGING_INSERT, [
      filePath,
      JSON.stringify({ rowNumber: index + 1, row }),
      asNullableInt(row['gログイン社員番号']),
      row['ログイン社員NM'] || null,
      null,
      ledgerNo,
      asNullableInt(row.部門CD),
      branchCode,
      asNullableInt(row.年),
      asNullableInt(row.月),
      asNullableDate(row.申請処理日),
      processingDate,
      asNullableInt(row.連番) ?? index + 1,
      entryTypeCode,
      null,
      counterpartyBranchCode,
      null,
      row.摘要 || row.内容 || '(raw legacy import)',
      responsibleEmployeeNo,
      null,
      otherAmount.toString(),
      legacyStampAmountTotal?.toString() ?? null,
      legacyTotalAmount?.toString() ?? null,
      legacyRunningTotalAmount?.toString() ?? null,
      null,
      row.備考 || null,
      asNullableBoolean(row.Is削除) ?? false,
      rawRedVoucherStatusCode({ originalLedgerNo, reversalLedgerNo }),
      originalLedgerNo,
      reversalLedgerNo,
      correctionLedgerNo,
      asNullableTimestamp(row.登録日時),
      registeredByEmployeeNo,
      asNullableTimestamp(row.更新日時) ?? asNullableTimestamp(row.登録日時),
      updatedByEmployeeNo,
      null,
      null,
      null,
      null,
      ...quantities,
    ]);

    inserted += result.rowCount ?? 0;
  }

  if (skippedRows.length > 0) {
    throw new Error(`Ledger import aborted: ${skippedRows.length} row(s) were missing required fields.\n${skippedRows.join('\n')}`);
  }

  return inserted;
}

async function loadExistingStagingLedgerNos(client: PoolClient): Promise<Map<number, ExistingStagingLedger>> {
  const result = await client.query<{
    ledger_no: string | number;
    branch_code: string | number | null;
    source_file: string;
  }>(
    `SELECT ledger_no, branch_code, source_file
       FROM legacy_filemaker_voucher_ledger_staging
      WHERE ledger_no IS NOT NULL`,
  );

  const existing = new Map<number, ExistingStagingLedger>();
  for (const row of result.rows) {
    const ledgerNo = Number(row.ledger_no);
    if (!Number.isInteger(ledgerNo)) continue;

    existing.set(ledgerNo, {
      ledgerNo,
      branchCode: row.branch_code == null ? null : Number(row.branch_code),
      sourceFile: row.source_file,
    });
  }
  return existing;
}

function assertLedgerNoImportIsSafe(input: {
  filePath: string;
  ledgerNo: number;
  branchCode: number;
  rowNumber: number;
  existing: ExistingStagingLedger | undefined;
  seen: SeenImportLedger | undefined;
}): void {
  if (input.seen) {
    throw new Error(
      `Ledger import aborted: 出納No ${input.ledgerNo} appears more than once in ${input.filePath} `
      + `(rows ${input.seen.rowNumber} and ${input.rowNumber}).`,
    );
  }

  if (!input.existing || input.existing.sourceFile === input.filePath) return;

  throw new Error(
    `Ledger import aborted: 出納No ${input.ledgerNo} from ${input.filePath} row ${input.rowNumber} `
    + `overlaps with ${input.existing.sourceFile} `
    + `(existing 拠点CD=${input.existing.branchCode ?? 'blank'}, incoming 拠点CD=${input.branchCode}). `
    + 'The current application treats 出納No as globally unique, so overlapping exports must be resolved before import.',
  );
}

function normalizedCounterpartyBranchCode(row: Record<string, string>, branchCode: number | null): number | null {
  const counterpartyBranchCode = asNullableInt(row['拠点CD[2]']);
  if (counterpartyBranchCode == null) return null;
  if (branchCode != null && counterpartyBranchCode === branchCode) return null;
  return counterpartyBranchCode;
}

async function loadEmployeeResolver(
  client: PoolClient,
): Promise<(name: string | undefined, branchCode: number) => number | null> {
  const result = await client.query<{
    employee_no: number | string;
    employee_name: string;
    branch_code: number | string | null;
  }>(`
    SELECT employee_no, employee_name, branch_code
      FROM employees
     WHERE employee_no > 0
       AND employee_name IS NOT NULL
  `);

  const byName = new Map<string, number[]>();
  const byNameBranch = new Map<string, number[]>();

  for (const row of result.rows) {
    const employeeNo = Number(row.employee_no);
    const name = normalizeEmployeeName(row.employee_name);
    if (!name || !Number.isInteger(employeeNo)) continue;

    const all = byName.get(name) ?? [];
    all.push(employeeNo);
    byName.set(name, all);

    if (row.branch_code != null) {
      const scopedKey = employeeNameBranchKey(name, Number(row.branch_code));
      const scoped = byNameBranch.get(scopedKey) ?? [];
      scoped.push(employeeNo);
      byNameBranch.set(scopedKey, scoped);
    }
  }

  return (rawName: string | undefined, branchCode: number): number | null => {
    const name = normalizeEmployeeName(rawName);
    if (!name) return null;

    const scoped = byNameBranch.get(employeeNameBranchKey(name, branchCode)) ?? [];
    if (scoped.length === 1) return scoped[0]!;

    const all = byName.get(name) ?? [];
    return all.length === 1 ? all[0]! : null;
  };
}

function normalizeEmployeeName(value: string | undefined): string {
  return (value ?? '').replace(/[\u3000\s]+/g, ' ').trim();
}

function employeeNameBranchKey(name: string, branchCode: number): string {
  return `${name}\0${branchCode}`;
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

function rawQuantitiesFromRow(row: Record<string, string>): number[] {
  if (row.枚数N?.includes('\x1d')) return rawQuantities(row.枚数N);

  return Array.from({ length: 16 }, (_, index) => {
    const key = index === 0 ? '枚数N' : `枚数N[${index + 1}]`;
    return asNullableInt(row[key]) ?? 0;
  });
}

function isLegacySummaryOnlyRow(row: Record<string, string>): boolean {
  const hasTransactionIdentity = Boolean(
    row.処理日
      || row.申請処理日
      || row.登録日時
      || row.更新日時
      || row.摘要
      || row.その他金額
      || row.切手金額合計
      || row.金額合計
      || row.枚数合計
  );
  return !hasTransactionIdentity && rawQuantitiesFromRow(row).every((quantity) => quantity === 0);
}

function stampAmountFromRepetitions(quantities: readonly number[]): bigint {
  return quantities.reduce((sum, quantity, index) => {
    const denomination = LEGACY_DENOMINATIONS_BY_REPETITION[index];
    return denomination == null ? sum : sum + BigInt(denomination) * BigInt(quantity);
  }, 0n);
}

function validateLegacyRowTotals(
  row: Record<string, string>,
  quantities: readonly number[],
  otherAmount: bigint,
  rowNumber: number,
): void {
  const stampAmount = stampAmountFromRepetitions(quantities);
  const totalAmount = stampAmount + otherAmount;
  const expectedStampAmount = asNullableBigInt(row.切手金額合計);
  const expectedTotalAmount = asNullableBigInt(row.金額合計);

  if (expectedStampAmount != null && expectedStampAmount !== stampAmount) {
    throw new Error(
      `Ledger import aborted: row ${rowNumber} 切手金額合計 mismatch. expected=${expectedStampAmount} computed=${stampAmount}`,
    );
  }

  if (expectedTotalAmount != null && expectedTotalAmount !== totalAmount) {
    throw new Error(
      `Ledger import aborted: row ${rowNumber} 金額合計 mismatch. expected=${expectedTotalAmount} computed=${totalAmount}`,
    );
  }
}

async function upsertBranches(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  const explicitActive = asNullableBoolean(mapped.active);
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
      explicitActive ?? Boolean(mapped.branch_name),
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
    `INSERT INTO departments (department_code, department_name, active, legacy_uuid)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (department_code) DO UPDATE SET
       department_name = EXCLUDED.department_name,
       active = EXCLUDED.active,
       legacy_uuid = COALESCE(EXCLUDED.legacy_uuid, departments.legacy_uuid),
       updated_at = now()`,
    [
      asRequiredInt(mapped.department_code, 'department_code'),
      mapped.department_name || `Department ${mapped.department_code}`,
      Boolean(mapped.department_name),
      mapped.legacy_uuid || null,
    ],
  );
}

async function upsertEmployees(client: PoolClient, mapped: Record<string, string>): Promise<void> {
  const employeeNo = asRequiredInt(mapped.employee_no, 'employee_no');
  if (employeeNo <= 0) return;

  const companyCode = asNullableInt(mapped.company_code);
  const departmentCode = asNullableInt(mapped.department_code);
  const branchCode = asNullableInt(mapped.branch_code);
  const companyName = mapped.company_name || (companyCode == null ? null : `Legacy company ${companyCode}`);
  const departmentName = mapped.department_name || (departmentCode == null ? null : `Legacy department ${departmentCode}`);
  const branchName = mapped.branch_name || (branchCode == null ? null : `Legacy branch ${branchCode}`);

  if (companyCode != null) {
    await client.query(
      `INSERT INTO companies (company_code, company_name)
       VALUES ($1,$2)
       ON CONFLICT (company_code) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         updated_at = now()`,
      [companyCode, companyName],
    );
  }

  if (departmentCode != null) {
    await client.query(
      `INSERT INTO departments (department_code, department_name, active)
       VALUES ($1,$2,$3)
       ON CONFLICT (department_code) DO UPDATE SET
         department_name = EXCLUDED.department_name,
         active = EXCLUDED.active,
         updated_at = now()`,
      [departmentCode, departmentName, Boolean(mapped.department_name)],
    );
  }

  if (branchCode != null) {
    await client.query(
      `INSERT INTO branches (branch_code, branch_name, active)
       VALUES ($1,$2,$3)
       ON CONFLICT (branch_code) DO UPDATE SET
         branch_name = EXCLUDED.branch_name,
         active = branches.active OR EXCLUDED.active,
         updated_at = now()`,
      [branchCode, branchName, Boolean(mapped.branch_name)],
    );
  }

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
      employeeNo,
      mapped.employee_name || `Employee ${mapped.employee_no}`,
      companyCode,
      departmentCode,
      branchCode,
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

export async function importMasterHtml(
  client: PoolClient,
  target: MasterImportTarget,
  filePath: string,
): Promise<number> {
  assertHtmlFile(filePath);
  const rows = readHtmlTableFile(filePath);
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
