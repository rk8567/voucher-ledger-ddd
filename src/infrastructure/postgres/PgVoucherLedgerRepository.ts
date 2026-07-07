import type { DbClient } from '@/application/db/postgres';
import type {
  BranchRecord,
  CurrentBalanceRecord,
  InventoryCheckRecord,
  LedgerEntryRecord,
  LedgerEntryListFilter,
  LedgerEntryListRecord,
  PostedLedgerEntryWithAmounts,
  VoucherLedgerRepository,
} from '@/application/repositories/VoucherLedgerRepository';
import type { DraftLedgerEntryInput } from '@/application/dto';
import { DENOMINATIONS, type QuantitySnapshot, stampAmountYen } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import { RedVoucherStatus, redVoucherStatusCodeOf } from '@/domain/redVoucherStatuses';

function numberOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (value === null || value === undefined) return 0;
  throw new Error(`Cannot convert value to number: ${String(value)}`);
}

function nullableNumberOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return numberOf(value);
}

function nullableStringOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableDateOnlyOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function mapBranch(row: Record<string, unknown>): BranchRecord {
  return {
    branchCode: numberOf(row.branch_code),
    branchName: String(row.branch_name),
    active: Boolean(row.active),
  };
}

function mapEntry(row: Record<string, unknown>): LedgerEntryRecord {
  return {
    id: String(row.id),
    ledgerNo: numberOf(row.ledger_no),
    branchCode: numberOf(row.branch_code),
    branchName: nullableStringOf(row.branch_name),
    departmentCode: nullableNumberOf(row.department_code),
    departmentName: nullableStringOf(row.department_name),
    periodYear: nullableNumberOf(row.period_year),
    periodMonth: nullableNumberOf(row.period_month),
    applicationDate: nullableDateOnlyOf(row.application_date),
    processingDate: nullableDateOnlyOf(row.processing_date) ?? '',
    dailySequence: numberOf(row.daily_sequence),
    entryTypeCode: numberOf(row.entry_type_code) as EntryTypeCode,
    entryTypeName: nullableStringOf(row.entry_type_name),
    transactionCategoryCode: nullableNumberOf(row.transaction_category_code),
    transactionCategoryName: nullableStringOf(row.transaction_category_name),
    counterpartyBranchCode: nullableNumberOf(row.counterparty_branch_code),
    counterpartyBranchName: nullableStringOf(row.counterparty_branch_name),
    statusCode: nullableNumberOf(row.status_code),
    companyCode: nullableNumberOf(row.company_code),
    companyName: nullableStringOf(row.company_name),
    responsibleEmployeeNo: nullableNumberOf(row.responsible_employee_no),
    responsibleEmployeeName: nullableStringOf(row.responsible_employee_name),
    description: String(row.description ?? ''),
    remarks: nullableStringOf(row.remarks),
    otherAmountYen: numberOf(row.other_amount),
    otherAmountNote: nullableStringOf(row.other_amount_note),
    redVoucherStatusCode: redVoucherStatusCodeOf(numberOf(row.red_voucher_status_code)),
    redVoucherStatusName: nullableStringOf(row.red_voucher_status_name),
    originalLedgerNo: nullableNumberOf(row.original_ledger_no),
    reversalLedgerNo: nullableNumberOf(row.reversal_ledger_no),
    correctionLedgerNo: nullableNumberOf(row.correction_ledger_no),
    isDeleted: Boolean(row.is_deleted),
    legacyRegisteredButtonClicked: row.legacy_registered_button_clicked == null
      ? false
      : Boolean(row.legacy_registered_button_clicked),
    registeredAt: nullableStringOf(row.registered_at),
    registeredByEmployeeNo: nullableNumberOf(row.registered_by_employee_no),
    registeredByEmployeeName: nullableStringOf(row.registered_by_employee_name),
    updatedAt: nullableStringOf(row.updated_at),
    updatedByEmployeeNo: nullableNumberOf(row.updated_by_employee_no),
    updatedByEmployeeName: nullableStringOf(row.updated_by_employee_name),
    postedAt: nullableStringOf(row.posted_at),
    filemakerCreatedAt: nullableStringOf(row.filemaker_created_at),
    filemakerCreatedBy: nullableStringOf(row.filemaker_created_by),
    filemakerModifiedAt: nullableStringOf(row.filemaker_modified_at),
    filemakerModifiedBy: nullableStringOf(row.filemaker_modified_by),
    filemakerLoginEmployeeNo: nullableNumberOf(row.filemaker_login_employee_no),
    filemakerLoginEmployeeName: nullableStringOf(row.filemaker_login_employee_name),
    createdAt: nullableStringOf(row.created_at),
  };
}

const LEDGER_ENTRY_FROM = `
    FROM voucher_ledger_entries e
    LEFT JOIN branches b ON b.branch_code = e.branch_code
    LEFT JOIN departments d ON d.department_code = e.department_code
    LEFT JOIN entry_types et ON et.code = e.entry_type_code
    LEFT JOIN transaction_categories tc ON tc.code = e.transaction_category_code
    LEFT JOIN branches cb ON cb.branch_code = e.counterparty_branch_code
    LEFT JOIN companies c ON c.company_code = e.company_code
    LEFT JOIN employees responsible ON responsible.employee_no = e.responsible_employee_no
    LEFT JOIN red_voucher_statuses rvs ON rvs.code = e.red_voucher_status_code
    LEFT JOIN employees registered_by ON registered_by.employee_no = e.registered_by_employee_no
    LEFT JOIN employees updated_by ON updated_by.employee_no = e.updated_by_employee_no
`;

const LEDGER_ENTRY_SELECT = `
  SELECT e.*,
         COUNT(*) OVER() AS total_count,
         b.branch_name AS branch_name,
         d.department_name AS department_name,
         et.name_japanese AS entry_type_name,
         tc.name_japanese AS transaction_category_name,
         cb.branch_name AS counterparty_branch_name,
         c.company_name AS company_name,
         responsible.employee_name AS responsible_employee_name,
         rvs.name_japanese AS red_voucher_status_name,
         registered_by.employee_name AS registered_by_employee_name,
         updated_by.employee_name AS updated_by_employee_name
${LEDGER_ENTRY_FROM}
`;

const LEDGER_SORT_EXPRESSIONS: Record<NonNullable<LedgerEntryListFilter['sortKey']>, string> = {
  ledgerNo: 'e.ledger_no',
  processingDate: 'e.processing_date',
  applicationDate: 'e.application_date',
  branchName: 'b.branch_name',
  departmentName: 'd.department_name',
  periodYear: 'e.period_year',
  periodMonth: 'e.period_month',
  entryTypeName: 'et.name_japanese',
  transactionCategoryName: 'tc.name_japanese',
  counterpartyBranchName: 'cb.branch_name',
  companyName: 'c.company_name',
  responsibleEmployeeName: 'responsible.employee_name',
  description: 'e.description',
  remarks: 'e.remarks',
  otherAmountYen: 'e.other_amount',
  otherAmountNote: 'e.other_amount_note',
  redVoucherStatusName: 'rvs.name_japanese',
  originalLedgerNo: 'e.original_ledger_no',
  reversalLedgerNo: 'e.reversal_ledger_no',
  correctionLedgerNo: 'e.correction_ledger_no',
  registeredAt: 'e.registered_at',
  registeredByEmployeeName: 'registered_by.employee_name',
  updatedAt: 'e.updated_at',
  updatedByEmployeeName: 'updated_by.employee_name',
  postedAt: 'e.posted_at',
  createdAt: 'e.created_at',
};

const LEDGER_COLUMN_FILTER_EXPRESSIONS: Record<string, { expression: string; kind: 'text' | 'exactText' | 'number' | 'date' | 'boolean' }> = {
  ledgerNo: { expression: 'e.ledger_no', kind: 'number' },
  processingDate: { expression: 'e.processing_date', kind: 'date' },
  applicationDate: { expression: 'e.application_date', kind: 'date' },
  branchName: { expression: 'b.branch_name', kind: 'exactText' },
  departmentName: { expression: 'd.department_name', kind: 'exactText' },
  periodYear: { expression: 'e.period_year', kind: 'number' },
  periodMonth: { expression: 'e.period_month', kind: 'number' },
  entryTypeName: { expression: 'et.name_japanese', kind: 'exactText' },
  transactionCategoryName: { expression: 'tc.name_japanese', kind: 'exactText' },
  counterpartyBranchName: { expression: 'cb.branch_name', kind: 'exactText' },
  companyName: { expression: 'c.company_name', kind: 'exactText' },
  responsibleEmployeeName: { expression: 'responsible.employee_name', kind: 'exactText' },
  description: { expression: 'e.description', kind: 'text' },
  remarks: { expression: 'e.remarks', kind: 'text' },
  otherAmountYen: { expression: 'e.other_amount', kind: 'number' },
  otherAmountNote: { expression: 'e.other_amount_note', kind: 'text' },
  redVoucherStatusName: { expression: 'rvs.name_japanese', kind: 'exactText' },
  isDeleted: { expression: 'e.is_deleted', kind: 'boolean' },
  originalLedgerNo: { expression: 'e.original_ledger_no', kind: 'number' },
  reversalLedgerNo: { expression: 'e.reversal_ledger_no', kind: 'number' },
  correctionLedgerNo: { expression: 'e.correction_ledger_no', kind: 'number' },
  registeredAt: { expression: 'e.registered_at', kind: 'date' },
  registeredByEmployeeName: { expression: 'registered_by.employee_name', kind: 'exactText' },
  updatedAt: { expression: 'e.updated_at', kind: 'date' },
  updatedByEmployeeName: { expression: 'updated_by.employee_name', kind: 'exactText' },
  postedAt: { expression: 'e.posted_at', kind: 'date' },
  createdAt: { expression: 'e.created_at', kind: 'date' },
};

function ledgerOrderBy(filter: LedgerEntryListFilter): string {
  const sortKey = filter.sortKey ?? 'ledgerNo';
  const expression = LEDGER_SORT_EXPRESSIONS[sortKey] ?? LEDGER_SORT_EXPRESSIONS.ledgerNo;
  const direction = filter.sortDirection === 'desc' ? 'DESC' : 'ASC';
  const tieBreakerDirection = sortKey === 'ledgerNo' ? direction : 'ASC';
  return `${expression} ${direction} NULLS LAST, e.ledger_no ${tieBreakerDirection}`;
}

function likePattern(value: string): string {
  return `%${value.trim()}%`;
}

function normalizeDateFilter(value: string): string {
  return value.trim().replaceAll('/', '-');
}

function numberFilterBounds(columnKey: string): { min?: number; max?: number } {
  if (columnKey === 'periodMonth') return { min: 1, max: 12 };
  return { min: 0 };
}

function numberFilterInBounds(columnKey: string, value: number): boolean {
  const bounds = numberFilterBounds(columnKey);
  if (bounds.min != null && value < bounds.min) return false;
  if (bounds.max != null && value > bounds.max) return false;
  return true;
}

function displayBalanceDenominations(
  denominationMap: ReadonlyMap<number, { runningQuantity: number; runningAmountYen: number }>,
): number[] {
  const active = new Set<number>(DENOMINATIONS);
  const historical = Array.from(denominationMap.entries())
    .filter(([denominationYen, balance]) => !active.has(denominationYen) && balance.runningQuantity !== 0)
    .map(([denominationYen]) => denominationYen)
    .sort((a, b) => a - b);
  return [...DENOMINATIONS, ...historical];
}

export class PgVoucherLedgerRepository implements VoucherLedgerRepository {
  constructor(private readonly db: DbClient) {}

  async lockBranch(branchCode: number): Promise<BranchRecord | null> {
    const result = await this.db.query(
      `SELECT branch_code, branch_name, active
         FROM branches
        WHERE branch_code = $1
        FOR UPDATE`,
      [branchCode],
    );
    return result.rowCount === 0 ? null : mapBranch(result.rows[0] as Record<string, unknown>);
  }

  async getBranch(branchCode: number): Promise<BranchRecord | null> {
    const result = await this.db.query(
      `SELECT branch_code, branch_name, active
         FROM branches
        WHERE branch_code = $1`,
      [branchCode],
    );
    return result.rowCount === 0 ? null : mapBranch(result.rows[0] as Record<string, unknown>);
  }

  async transactionCategoryRequiresCounterparty(code: number): Promise<boolean> {
    const result = await this.db.query(
      `SELECT requires_counterparty_branch
         FROM transaction_categories
        WHERE code = $1`,
      [code],
    );
    return result.rows.length > 0 && Boolean(result.rows[0]?.requires_counterparty_branch);
  }

  async hasOpeningBalance(branchCode: number): Promise<boolean> {
    const result = await this.db.query(
      `SELECT EXISTS (
         SELECT 1
           FROM voucher_ledger_entries
          WHERE branch_code = $1
            AND entry_type_code = $2
            AND posted_at IS NOT NULL
            AND is_deleted = false
       ) AS exists`,
      [branchCode, EntryTypeCode.OpeningBalance],
    );
    return Boolean(result.rows[0].exists);
  }

  async nextDailySequence(branchCode: number, processingDate: string): Promise<number> {
    const result = await this.db.query(
      `SELECT COALESCE(MAX(daily_sequence), 0) + 1 AS next_sequence
         FROM voucher_ledger_entries
        WHERE branch_code = $1
          AND processing_date = $2
          AND is_deleted = false`,
      [branchCode, processingDate],
    );
    return numberOf(result.rows[0].next_sequence);
  }

  async insertDraftEntry(input: DraftLedgerEntryInput): Promise<LedgerEntryRecord> {
    const result = await this.db.query(
      `INSERT INTO voucher_ledger_entries (
         branch_code,
         department_code,
         period_year,
         period_month,
         application_date,
         processing_date,
         daily_sequence,
         entry_type_code,
         transaction_category_code,
         counterparty_branch_code,
         status_code,
         company_code,
         responsible_employee_no,
         description,
         remarks,
         other_amount,
         other_amount_note,
         red_voucher_status_code,
         original_ledger_no,
         reversal_ledger_no,
         correction_ledger_no,
         registered_by_employee_no,
         updated_by_employee_no
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18,
         $19, $20, $21, $22, $22
       )
       RETURNING *`,
      [
        input.branchCode,
        input.departmentCode ?? null,
        input.periodYear ?? null,
        input.periodMonth ?? null,
        input.applicationDate ?? null,
        input.processingDate,
        input.dailySequence,
        input.entryTypeCode,
        input.transactionCategoryCode ?? null,
        input.counterpartyBranchCode ?? null,
        input.statusCode ?? null,
        input.companyCode ?? null,
        input.responsibleEmployeeNo ?? null,
        input.description,
        input.remarks ?? null,
        input.otherAmountYen,
        input.otherAmountNote ?? null,
        input.redVoucherStatusCode ?? RedVoucherStatus.Normal,
        input.originalLedgerNo ?? null,
        input.reversalLedgerNo ?? null,
        input.correctionLedgerNo ?? null,
        input.actorEmployeeNo ?? null,
      ],
    );

    return mapEntry(result.rows[0] as Record<string, unknown>);
  }

  async replaceQuantities(entryId: string, quantities: QuantitySnapshot): Promise<void> {
    await this.db.query(`DELETE FROM voucher_ledger_entry_denominations WHERE entry_id = $1`, [entryId]);

    for (const [rawDenominationYen, quantity] of Object.entries(quantities)) {
      const denominationYen = Number(rawDenominationYen);
      if (quantity <= 0) continue;

      await this.db.query(
        `INSERT INTO voucher_ledger_entry_denominations (entry_id, denomination_yen, quantity)
         VALUES ($1, $2, $3)`,
        [entryId, denominationYen, quantity],
      );
    }
  }

  async postEntry(entryId: string, actorEmployeeNo?: number | null): Promise<LedgerEntryRecord> {
    const result = await this.db.query(
      `UPDATE voucher_ledger_entries
          SET posted_at = COALESCE(posted_at, now()),
              updated_by_employee_no = $2
        WHERE id = $1
          AND posted_at IS NULL
          AND is_deleted = false
        RETURNING *`,
      [entryId, actorEmployeeNo ?? null],
    );

    if (result.rowCount === 0) {
      throw new Error(`Draft ledger entry not found or already posted: ${entryId}`);
    }

    return mapEntry(result.rows[0] as Record<string, unknown>);
  }

  async getPostedEntryForUpdateByLedgerNo(ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null> {
    const entryResult = await this.db.query(
      `SELECT *
         FROM voucher_ledger_entries
        WHERE ledger_no = $1
          AND posted_at IS NOT NULL
          AND is_deleted = false
        FOR UPDATE`,
      [ledgerNo],
    );

    if (entryResult.rowCount === 0) return null;

    const entry = mapEntry(entryResult.rows[0] as Record<string, unknown>);
    const quantityResult = await this.db.query(
      `SELECT denomination_yen, quantity
         FROM voucher_ledger_entry_denominations
        WHERE entry_id = $1`,
      [entry.id],
    );

    const quantities: QuantitySnapshot = {};
    for (const row of quantityResult.rows as Record<string, unknown>[]) {
      quantities[numberOf(row.denomination_yen)] = numberOf(row.quantity);
    }

    const stampAmount = stampAmountYen(quantities);

    return {
      ...entry,
      quantities,
      stampAmountYen: stampAmount,
      totalAmountYen: stampAmount + entry.otherAmountYen,
    };
  }

  async markOriginalWithReversal(
    originalLedgerNo: number,
    reversalLedgerNo: number,
    actorEmployeeNo?: number | null,
  ): Promise<void> {
    const result = await this.db.query(
      `UPDATE voucher_ledger_entries
          SET red_voucher_status_code = $4,
              reversal_ledger_no = $2,
              updated_by_employee_no = $3
        WHERE ledger_no = $1
          AND posted_at IS NOT NULL
          AND is_deleted = false`,
      [originalLedgerNo, reversalLedgerNo, actorEmployeeNo ?? null, RedVoucherStatus.Original],
    );

    if (result.rowCount !== 1) {
      throw new Error(`Original ledger entry not found: ${originalLedgerNo}`);
    }
  }

  async linkCorrection(
    originalLedgerNo: number,
    reversalLedgerNo: number,
    correctionLedgerNo: number,
    actorEmployeeNo?: number | null,
  ): Promise<void> {
    const originalResult = await this.db.query(
      `UPDATE voucher_ledger_entries
          SET correction_ledger_no = $2,
              updated_by_employee_no = $3
        WHERE ledger_no = $1
          AND posted_at IS NOT NULL`,
      [originalLedgerNo, correctionLedgerNo, actorEmployeeNo ?? null],
    );

    const reversalResult = await this.db.query(
      `UPDATE voucher_ledger_entries
          SET correction_ledger_no = $2,
              updated_by_employee_no = $3
        WHERE ledger_no = $1
          AND posted_at IS NOT NULL`,
      [reversalLedgerNo, correctionLedgerNo, actorEmployeeNo ?? null],
    );

    if (originalResult.rowCount !== 1 || reversalResult.rowCount !== 1) {
      throw new Error('Failed to link correction ledger entry.');
    }
  }

  async listLedgerEntries(filter: LedgerEntryListFilter): Promise<LedgerEntryListRecord> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const values: unknown[] = [];
    const where: string[] = [];

    function add(value: unknown): string {
      values.push(value);
      return `$${values.length}`;
    }

    if (filter.branchCode != null) where.push(`e.branch_code = ${add(filter.branchCode)}`);
    if (filter.periodYear != null) where.push(`e.period_year = ${add(filter.periodYear)}`);
    if (filter.periodMonth != null) where.push(`e.period_month = ${add(filter.periodMonth)}`);
    if (filter.processingDateFrom != null) where.push(`e.processing_date >= ${add(filter.processingDateFrom)}`);
    if (filter.processingDateTo != null) where.push(`e.processing_date <= ${add(filter.processingDateTo)}`);
    if (filter.entryTypeCode != null) where.push(`e.entry_type_code = ${add(filter.entryTypeCode)}`);
    for (const [key, value] of Object.entries(filter.columnFilters ?? {})) {
      const filterColumn = LEDGER_COLUMN_FILTER_EXPRESSIONS[key];
      const trimmed = value?.trim();
      if (!filterColumn || !trimmed) continue;
      if (filterColumn.kind === 'number') {
        const numericValue = Number(trimmed);
        where.push(Number.isFinite(numericValue) && Number.isInteger(numericValue) && numberFilterInBounds(key, numericValue)
          ? `${filterColumn.expression} = ${add(numericValue)}`
          : 'false');
        continue;
      }
      if (filterColumn.kind === 'date') {
        where.push(`${filterColumn.expression}::text ILIKE ${add(likePattern(normalizeDateFilter(trimmed)))}`);
        continue;
      }
      if (filterColumn.kind === 'boolean') {
        if (trimmed !== 'true' && trimmed !== 'false') {
          where.push('false');
          continue;
        }
        where.push(`${filterColumn.expression} = ${add(trimmed === 'true')}`);
        continue;
      }
      if (filterColumn.kind === 'exactText') {
        where.push(`${filterColumn.expression} ILIKE ${add(likePattern(trimmed))}`);
        continue;
      }
      where.push(`${filterColumn.expression} ILIKE ${add(likePattern(trimmed))}`);
    }
    if (!filter.includeDeleted) where.push('e.is_deleted = false');

    const whereSql = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    const countValues = [...values];
    const result = await this.db.query(
      `${LEDGER_ENTRY_SELECT}
        ${whereSql}
        ORDER BY ${ledgerOrderBy(filter)}
        LIMIT ${add(limit + 1)}
        OFFSET ${add(offset)}`,
      values,
    );

    const rawRows = result.rows as Record<string, unknown>[];
    const rows = rawRows.map(mapEntry);
    const items = rows.slice(0, limit);
    const totalCount = rawRows.length > 0
      ? numberOf(rawRows[0]?.total_count)
      : await this.countLedgerEntries(whereSql, countValues);
    return {
      items,
      totalCount,
    };
  }

  private async countLedgerEntries(whereSql: string, values: readonly unknown[]): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(*) AS total_count
${LEDGER_ENTRY_FROM}
        ${whereSql}`,
      [...values],
    );
    return numberOf(result.rows[0]?.total_count);
  }

  async getLedgerEntryByLedgerNo(ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null> {
    const entryResult = await this.db.query(
      `${LEDGER_ENTRY_SELECT}
        WHERE e.ledger_no = $1
          AND e.posted_at IS NOT NULL`,
      [ledgerNo],
    );

    if (entryResult.rowCount === 0) return null;

    const entry = mapEntry(entryResult.rows[0] as Record<string, unknown>);
    const quantityResult = await this.db.query(
      `SELECT denomination_yen, quantity
         FROM voucher_ledger_entry_denominations
        WHERE entry_id = $1`,
      [entry.id],
    );

    const quantities: QuantitySnapshot = {};
    for (const row of quantityResult.rows as Record<string, unknown>[]) {
      quantities[numberOf(row.denomination_yen)] = numberOf(row.quantity);
    }

    const stampAmount = stampAmountYen(quantities);
    return {
      ...entry,
      quantities,
      stampAmountYen: stampAmount,
      totalAmountYen: stampAmount + entry.otherAmountYen,
    };
  }

  async getCurrentBalance(branchCode: number): Promise<CurrentBalanceRecord> {
    const totalResult = await this.db.query(
      `SELECT r.ledger_no,
              r.running_stamp_amount,
              r.running_other_amount,
              r.running_total_amount
         FROM voucher_ledger_running_amounts r
         JOIN voucher_ledger_entries e ON e.ledger_no = r.ledger_no
        WHERE r.branch_code = $1
        ORDER BY e.processing_date DESC, e.daily_sequence DESC, e.ledger_no DESC
        LIMIT 1`,
      [branchCode],
    );

    const denominationResult = await this.db.query(
      `SELECT DISTINCT ON (r.denomination_yen)
              r.denomination_yen,
              r.running_quantity,
              r.running_quantity::bigint * r.denomination_yen::bigint AS running_amount_yen
         FROM voucher_ledger_running_denominations r
         JOIN voucher_ledger_entries e ON e.ledger_no = r.ledger_no
        WHERE r.branch_code = $1
        ORDER BY r.denomination_yen, e.processing_date DESC, e.daily_sequence DESC, e.ledger_no DESC`,
      [branchCode],
    );

    const denominationMap = new Map<number, { runningQuantity: number; runningAmountYen: number }>();
    for (const row of denominationResult.rows as Record<string, unknown>[]) {
      denominationMap.set(numberOf(row.denomination_yen), {
        runningQuantity: numberOf(row.running_quantity),
        runningAmountYen: numberOf(row.running_amount_yen),
      });
    }

    if (totalResult.rowCount === 0) {
      return {
        branchCode,
        asOfLedgerNo: null,
        runningStampAmountYen: 0,
        runningOtherAmountYen: 0,
        runningTotalAmountYen: 0,
        denominations: DENOMINATIONS.map((denominationYen) => ({
          denominationYen,
          runningQuantity: 0,
          runningAmountYen: 0,
        })),
      };
    }

    const row = totalResult.rows[0] as Record<string, unknown>;
    return {
      branchCode,
      asOfLedgerNo: nullableNumberOf(row.ledger_no),
      runningStampAmountYen: numberOf(row.running_stamp_amount),
      runningOtherAmountYen: numberOf(row.running_other_amount),
      runningTotalAmountYen: numberOf(row.running_total_amount),
      denominations: displayBalanceDenominations(denominationMap).map((denominationYen) => {
        const balance = denominationMap.get(denominationYen);
        return {
          denominationYen,
          runningQuantity: balance?.runningQuantity ?? 0,
          runningAmountYen: balance?.runningAmountYen ?? 0,
        };
      }),
    };
  }

  async getInventoryCheckResult(entryId: string): Promise<InventoryCheckRecord | null> {
    const result = await this.db.query(
      `SELECT entry_id,
              ledger_no,
              branch_code,
              actual_total_amount,
              expected_total_amount,
              discrepancy_amount
         FROM voucher_inventory_check_results
        WHERE entry_id = $1`,
      [entryId],
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0] as Record<string, unknown>;
    return {
      entryId: String(row.entry_id),
      ledgerNo: numberOf(row.ledger_no),
      branchCode: numberOf(row.branch_code),
      actualTotalAmountYen: numberOf(row.actual_total_amount),
      expectedTotalAmountYen: numberOf(row.expected_total_amount),
      discrepancyAmountYen: numberOf(row.discrepancy_amount),
    };
  }
}
