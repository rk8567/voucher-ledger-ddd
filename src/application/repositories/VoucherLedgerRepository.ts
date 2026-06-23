import type { QuantitySnapshot } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import type { DraftLedgerEntryInput } from '@/application/dto';

export type BranchRecord = Readonly<{
  branchCode: number;
  branchName: string;
  active: boolean;
}>;

export type LedgerEntryRecord = Readonly<{
  id: string;
  ledgerNo: number;
  branchCode: number;
  branchName: string | null;
  departmentCode: number | null;
  departmentName: string | null;
  periodYear: number | null;
  periodMonth: number | null;
  applicationDate: string | null;
  processingDate: string;
  dailySequence: number;
  entryTypeCode: EntryTypeCode;
  entryTypeName: string | null;
  transactionCategoryCode: number | null;
  transactionCategoryName: string | null;
  counterpartyBranchCode: number | null;
  counterpartyBranchName: string | null;
  statusCode: number | null;
  companyCode: number | null;
  companyName: string | null;
  responsibleEmployeeNo: number | null;
  responsibleEmployeeName: string | null;
  description: string;
  remarks: string | null;
  otherAmountYen: number;
  otherAmountNote: string | null;
  redVoucherStatusCode: 0 | 1 | 2 | 3;
  redVoucherStatusName: string | null;
  originalLedgerNo: number | null;
  reversalLedgerNo: number | null;
  correctionLedgerNo: number | null;
  isDeleted: boolean;
  legacyRegisteredButtonClicked: boolean;
  registeredAt: string | null;
  registeredByEmployeeNo: number | null;
  registeredByEmployeeName: string | null;
  updatedAt: string | null;
  updatedByEmployeeNo: number | null;
  updatedByEmployeeName: string | null;
  postedAt: string | null;
  filemakerCreatedAt: string | null;
  filemakerCreatedBy: string | null;
  filemakerModifiedAt: string | null;
  filemakerModifiedBy: string | null;
  filemakerLoginEmployeeNo: number | null;
  filemakerLoginEmployeeName: string | null;
  createdAt: string | null;
}>;

export type PostedLedgerEntryWithAmounts = LedgerEntryRecord &
  Readonly<{
    quantities: QuantitySnapshot;
    stampAmountYen: number;
    totalAmountYen: number;
  }>;

export type CurrentBalanceRecord = Readonly<{
  branchCode: number;
  asOfLedgerNo: number | null;
  runningStampAmountYen: number;
  runningOtherAmountYen: number;
  runningTotalAmountYen: number;
  denominations: readonly Readonly<{
    denominationYen: number;
    runningQuantity: number;
    runningAmountYen: number;
  }>[];
}>;

export type InventoryCheckRecord = Readonly<{
  entryId: string;
  ledgerNo: number;
  branchCode: number;
  actualTotalAmountYen: number;
  expectedTotalAmountYen: number;
  discrepancyAmountYen: number;
}>;

export type LedgerEntryListFilter = Readonly<{
  branchCode?: number | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  processingDateFrom?: string | null;
  processingDateTo?: string | null;
  entryTypeCode?: EntryTypeCode | null;
  columnFilters?: Readonly<Record<string, string | null | undefined>> | null;
  includeDeleted?: boolean;
  limit?: number | null;
  offset?: number | null;
  cursorLedgerNo?: number | null;
  sortKey?: LedgerEntrySortKey | null;
  sortDirection?: SortDirection | null;
}>;

export type LedgerEntrySortKey =
  | 'ledgerNo'
  | 'processingDate'
  | 'branchName'
  | 'entryTypeName'
  | 'responsibleEmployeeName'
  | 'description'
  | 'otherAmountYen';

export type SortDirection = 'asc' | 'desc';

export type LedgerEntryListRecord = Readonly<{
  items: readonly LedgerEntryRecord[];
  totalCount: number;
  nextCursorLedgerNo: number | null;
}>;

export interface VoucherLedgerRepository {
  lockBranch(branchCode: number): Promise<BranchRecord | null>;
  getBranch(branchCode: number): Promise<BranchRecord | null>;
  transactionCategoryRequiresCounterparty(code: number): Promise<boolean>;

  hasOpeningBalance(branchCode: number): Promise<boolean>;
  nextDailySequence(branchCode: number, processingDate: string): Promise<number>;

  insertDraftEntry(input: DraftLedgerEntryInput): Promise<LedgerEntryRecord>;
  replaceQuantities(entryId: string, quantities: QuantitySnapshot): Promise<void>;
  postEntry(entryId: string, actorEmployeeNo?: number | null): Promise<LedgerEntryRecord>;

  getPostedEntryForUpdateByLedgerNo(ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null>;
  markOriginalWithReversal(originalLedgerNo: number, reversalLedgerNo: number, actorEmployeeNo?: number | null): Promise<void>;
  linkCorrection(originalLedgerNo: number, reversalLedgerNo: number, correctionLedgerNo: number, actorEmployeeNo?: number | null): Promise<void>;

  listLedgerEntries(filter: LedgerEntryListFilter): Promise<LedgerEntryListRecord>;
  getLedgerEntryByLedgerNo(ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null>;
  getCurrentBalance(branchCode: number): Promise<CurrentBalanceRecord>;
  getInventoryCheckResult(entryId: string): Promise<InventoryCheckRecord | null>;
}
