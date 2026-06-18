import 'server-only';

import { GetBranchCurrentBalanceQuery } from '@/application/queries/GetBranchCurrentBalance';
import { GetLedgerEntryQuery } from '@/application/queries/GetLedgerEntry';
import { ListLedgerEntriesQuery } from '@/application/queries/ListLedgerEntries';
import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type {
  CurrentBalanceRecord,
  LedgerEntryListFilter,
  LedgerEntryListRecord,
  PostedLedgerEntryWithAmounts,
} from '@/application/repositories/VoucherLedgerRepository';
import { EntryTypeCode } from '@/domain/entryTypes';

export type LedgerSearchInput = Readonly<{
  branchCode?: number | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  processingDateFrom?: string | null;
  processingDateTo?: string | null;
  entryTypeCode?: EntryTypeCode | null;
  ledgerNo?: number | null;
}>;

export type LedgerDashboardData = Readonly<{
  entries: LedgerEntryListRecord;
  selectedEntry: PostedLedgerEntryWithAmounts | null;
  currentBalance: CurrentBalanceRecord | null;
}>;

async function getQueries(): Promise<{
  listLedgerEntriesQuery: ListLedgerEntriesQuery;
  getLedgerEntryQuery: GetLedgerEntryQuery;
  getBranchCurrentBalanceQuery: GetBranchCurrentBalanceQuery;
}> {
  const { unitOfWork } = await import('@/infrastructure/postgres/singletons');
  return createQueries(unitOfWork);
}

function createQueries(unitOfWork: UnitOfWork) {
  return {
    listLedgerEntriesQuery: new ListLedgerEntriesQuery(unitOfWork),
    getLedgerEntryQuery: new GetLedgerEntryQuery(unitOfWork),
    getBranchCurrentBalanceQuery: new GetBranchCurrentBalanceQuery(unitOfWork),
  };
}

export async function getLedgerDashboardData(input: LedgerSearchInput): Promise<LedgerDashboardData> {
  const { listLedgerEntriesQuery, getLedgerEntryQuery, getBranchCurrentBalanceQuery } = await getQueries();
  const filter: LedgerEntryListFilter = {
    branchCode: input.branchCode,
    periodYear: input.periodYear,
    periodMonth: input.periodMonth,
    processingDateFrom: input.processingDateFrom,
    processingDateTo: input.processingDateTo,
    entryTypeCode: input.entryTypeCode,
    includeDeleted: false,
    limit: 50,
  };

  const entries = await listLedgerEntriesQuery.execute(filter);
  const selectedLedgerNo = input.ledgerNo ?? entries.items[0]?.ledgerNo ?? null;
  const selectedEntry = selectedLedgerNo == null ? null : await getLedgerEntryQuery.execute(selectedLedgerNo);
  const balanceBranchCode = input.branchCode ?? selectedEntry?.branchCode ?? entries.items[0]?.branchCode ?? null;
  const currentBalance = balanceBranchCode == null ? null : await getBranchCurrentBalanceQuery.execute(balanceBranchCode);

  return {
    entries,
    selectedEntry,
    currentBalance,
  };
}
