import 'server-only';

import { unstable_cache } from 'next/cache';
import { GetBranchCurrentBalanceQuery } from '@/application/queries/GetBranchCurrentBalance';
import { GetLedgerEntryQuery } from '@/application/queries/GetLedgerEntry';
import { ListLedgerEntriesQuery } from '@/application/queries/ListLedgerEntries';
import type { DbClient } from '@/application/db/postgres';
import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type {
  CurrentBalanceRecord,
  LedgerEntryListFilter,
  LedgerEntryListRecord,
  LedgerEntrySortKey,
  PostedLedgerEntryWithAmounts,
  SortDirection,
} from '@/application/repositories/VoucherLedgerRepository';
import { EntryTypeCode } from '@/domain/entryTypes';
import { RedVoucherStatus } from '@/domain/redVoucherStatuses';

export const LEDGER_DATA_CACHE_TAG = 'ledger-data';
export const LEDGER_REFERENCE_CACHE_TAG = 'ledger-reference-data';
export const DEFAULT_LEDGER_PAGE_SIZE = 50;

export type LedgerSearchInput = Readonly<{
  branchCode?: number | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  processingDateFrom?: string | null;
  processingDateTo?: string | null;
  entryTypeCode?: EntryTypeCode | null;
  columnFilters?: Readonly<Record<string, string | null | undefined>> | null;
  ledgerNo?: number | null;
  limit?: number | null;
  page?: number | null;
  sortKey?: LedgerEntrySortKey | null;
  sortDirection?: SortDirection | null;
}>;

export type LedgerDashboardData = Readonly<{
  entries: LedgerEntryListRecord;
  deletedEntries: LedgerEntryListRecord;
  selectedEntry: PostedLedgerEntryWithAmounts | null;
  correctionTrail: LedgerCorrectionTrail | null;
  currentBalance: CurrentBalanceRecord | null;
  formOptions: LedgerFormOptions;
}>;

export type LedgerCorrectionTrail = Readonly<{
  originalLedgerNo: number | null;
  reversalLedgerNo: number | null;
  correctionLedgerNo: number | null;
}>;

export type LedgerSelectOption = Readonly<{
  value: number;
  label: string;
}>;

export type LedgerFormOptions = Readonly<{
  branches: readonly LedgerSelectOption[];
  entryTypes: readonly LedgerSelectOption[];
  employees: readonly LedgerSelectOption[];
  transactionCategories: readonly LedgerSelectOption[];
  redVoucherStatuses: readonly LedgerSelectOption[];
  companies: readonly LedgerSelectOption[];
  departments: readonly LedgerSelectOption[];
}>;

async function getQueries(): Promise<{
  listLedgerEntriesQuery: ListLedgerEntriesQuery;
  getLedgerEntryQuery: GetLedgerEntryQuery;
  getBranchCurrentBalanceQuery: GetBranchCurrentBalanceQuery;
}> {
  const { unitOfWork } = await import('@/infrastructure/postgres/singletons');
  return createQueries(unitOfWork);
}

async function getPgPool(): Promise<DbClient> {
  const { pgPool } = await import('@/infrastructure/postgres/singletons');
  return pgPool;
}

function createQueries(unitOfWork: UnitOfWork) {
  return {
    listLedgerEntriesQuery: new ListLedgerEntriesQuery(unitOfWork),
    getLedgerEntryQuery: new GetLedgerEntryQuery(unitOfWork),
    getBranchCurrentBalanceQuery: new GetBranchCurrentBalanceQuery(unitOfWork),
  };
}

export async function getLedgerDashboardData(input: LedgerSearchInput): Promise<LedgerDashboardData> {
  const limit = input.limit ?? DEFAULT_LEDGER_PAGE_SIZE;
  const page = Math.max(input.page ?? 1, 1);
  const filter: LedgerEntryListFilter = {
    ...ledgerFilterFromInput(input),
    limit,
    offset: (page - 1) * limit,
  };

  const deletedFilter: LedgerEntryListFilter = {
    ...ledgerFilterFromInput(input),
    columnFilters: {
      ...(input.columnFilters ?? {}),
      isDeleted: 'true',
    },
    includeDeleted: true,
    limit: 50,
    offset: 0,
    sortKey: input.sortKey ?? 'ledgerNo',
    sortDirection: input.sortDirection ?? 'desc',
  };

  const [entries, deletedEntries] = await Promise.all([
    getCachedLedgerEntries(filter),
    getCachedLedgerEntries(deletedFilter),
  ]);
  const selectedLedgerNo = input.ledgerNo ?? entries.items[0]?.ledgerNo ?? null;
  const selectedEntry = selectedLedgerNo == null ? null : await getCachedLedgerEntry(selectedLedgerNo);
  const correctionTrail = selectedEntry == null ? null : await getCorrectionTrail(selectedEntry);
  const balanceBranchCode = input.branchCode ?? selectedEntry?.branchCode ?? entries.items[0]?.branchCode ?? null;
  const [currentBalance, formOptions] = await Promise.all([
    balanceBranchCode == null ? null : getCachedBranchCurrentBalance(balanceBranchCode),
    getCachedLedgerFormOptions(),
  ]);

  return {
    entries,
    deletedEntries,
    selectedEntry,
    correctionTrail,
    currentBalance,
    formOptions,
  };
}

async function getCorrectionTrail(selectedEntry: PostedLedgerEntryWithAmounts): Promise<LedgerCorrectionTrail | null> {
  const hasCorrectionLink = selectedEntry.redVoucherStatusCode !== RedVoucherStatus.Normal
    || selectedEntry.originalLedgerNo != null
    || selectedEntry.reversalLedgerNo != null
    || selectedEntry.correctionLedgerNo != null;

  if (!hasCorrectionLink) return null;

  const originalEntry = selectedEntry.originalLedgerNo == null
    ? selectedEntry
    : await getCachedLedgerEntry(selectedEntry.originalLedgerNo) ?? selectedEntry;

  return {
    originalLedgerNo: selectedEntry.redVoucherStatusCode === RedVoucherStatus.Original
      ? selectedEntry.ledgerNo
      : selectedEntry.originalLedgerNo ?? originalEntry.ledgerNo,
    reversalLedgerNo: selectedEntry.redVoucherStatusCode === RedVoucherStatus.Reversal
      ? selectedEntry.ledgerNo
      : originalEntry.reversalLedgerNo ?? selectedEntry.reversalLedgerNo,
    correctionLedgerNo: selectedEntry.redVoucherStatusCode === RedVoucherStatus.Correction
      ? selectedEntry.ledgerNo
      : originalEntry.correctionLedgerNo ?? selectedEntry.correctionLedgerNo,
  };
}

export async function getLedgerExportEntries(input: LedgerSearchInput): Promise<readonly LedgerEntryListRecord['items'][number][]> {
  const { listLedgerEntriesQuery } = await getQueries();
  const pageSize = 200;
  const maxRows = 50_000;
  const items: LedgerEntryListRecord['items'][number][] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const result = await listLedgerEntriesQuery.execute({
      ...ledgerFilterFromInput(input),
      limit: pageSize,
      offset,
    });

    items.push(...result.items);
    if (items.length >= result.totalCount || result.items.length === 0) break;
  }

  return items;
}

function ledgerFilterFromInput(input: LedgerSearchInput): LedgerEntryListFilter {
  return {
    branchCode: input.branchCode,
    periodYear: input.periodYear,
    periodMonth: input.periodMonth,
    processingDateFrom: input.processingDateFrom,
    processingDateTo: input.processingDateTo,
    entryTypeCode: input.entryTypeCode,
    columnFilters: input.columnFilters,
    sortKey: input.sortKey,
    sortDirection: input.sortDirection,
  };
}

const getCachedLedgerEntries = unstable_cache(
  async (filter: LedgerEntryListFilter): Promise<LedgerEntryListRecord> => {
    const { listLedgerEntriesQuery } = await getQueries();
    return listLedgerEntriesQuery.execute(filter);
  },
  ['ledger-entries'],
  { revalidate: 30, tags: [LEDGER_DATA_CACHE_TAG] },
);

const getCachedLedgerEntry = unstable_cache(
  async (ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null> => {
    const { getLedgerEntryQuery } = await getQueries();
    return getLedgerEntryQuery.execute(ledgerNo);
  },
  ['ledger-entry'],
  { revalidate: 30, tags: [LEDGER_DATA_CACHE_TAG] },
);

const getCachedBranchCurrentBalance = unstable_cache(
  async (branchCode: number): Promise<CurrentBalanceRecord | null> => {
    const { getBranchCurrentBalanceQuery } = await getQueries();
    return getBranchCurrentBalanceQuery.execute(branchCode);
  },
  ['branch-current-balance'],
  { revalidate: 30, tags: [LEDGER_DATA_CACHE_TAG] },
);

const getCachedLedgerFormOptions = unstable_cache(
  async (): Promise<LedgerFormOptions> => getLedgerFormOptions(),
  ['ledger-form-options'],
  { revalidate: 3600, tags: [LEDGER_REFERENCE_CACHE_TAG] },
);

async function getLedgerFormOptions(): Promise<LedgerFormOptions> {
  const pgPool = await getPgPool();
  const [
    branches,
    entryTypes,
    employees,
    transactionCategories,
    redVoucherStatuses,
    companies,
    departments,
  ] = await Promise.all([
    pgPool.query<{ value: number; label: string }>(`
      SELECT branch_code AS value, branch_name AS label
        FROM branches
       WHERE active = true
       ORDER BY branch_code
    `),
    pgPool.query<{ value: number; label: string }>(`
      SELECT code AS value, name_japanese AS label
        FROM entry_types
       ORDER BY code
    `),
    pgPool.query<{ value: number; label: string }>(`
      SELECT employee_no AS value, employee_name AS label
        FROM employees
       WHERE active = true
       ORDER BY employee_name, employee_no
    `),
    pgPool.query<{ value: number; label: string }>(`
      SELECT code AS value, name_japanese AS label
        FROM transaction_categories
       WHERE selectable = true
       ORDER BY code
    `),
    pgPool.query<{ value: number; label: string }>(`
      SELECT code AS value, name_japanese AS label
        FROM red_voucher_statuses
       ORDER BY code
    `),
    pgPool.query<{ value: number; label: string }>(`
      SELECT company_code AS value, company_name AS label
        FROM companies
       ORDER BY company_code
    `),
    pgPool.query<{ value: number; label: string }>(`
      SELECT department_code AS value, department_name AS label
        FROM departments
       WHERE active = true
       ORDER BY department_code
    `),
  ]);

  return {
    branches: branches.rows.map(optionFromRow),
    entryTypes: entryTypes.rows.map(optionFromRow),
    employees: employees.rows.map(optionFromRow),
    transactionCategories: transactionCategories.rows.map(optionFromRow),
    redVoucherStatuses: redVoucherStatuses.rows.map(optionFromRow),
    companies: companies.rows.map(optionFromRow),
    departments: departments.rows.map(optionFromRow),
  };
}

function optionFromRow(row: { value: number; label: string }): LedgerSelectOption {
  return {
    value: Number(row.value),
    label: row.label,
  };
}
