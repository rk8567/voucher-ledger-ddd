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
  departmentCode: number | null;
  periodYear: number | null;
  periodMonth: number | null;
  applicationDate: string | null;
  processingDate: string;
  dailySequence: number;
  entryTypeCode: EntryTypeCode;
  transactionCategoryCode: number | null;
  counterpartyBranchCode: number | null;
  statusCode: number | null;
  companyCode: number | null;
  responsibleEmployeeNo: number | null;
  description: string;
  remarks: string | null;
  otherAmountYen: number;
  otherAmountNote: string | null;
  redVoucherStatusCode: 0 | 1 | 2 | 3;
  originalLedgerNo: number | null;
  reversalLedgerNo: number | null;
  correctionLedgerNo: number | null;
  postedAt: string | null;
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

  getCurrentBalance(branchCode: number): Promise<CurrentBalanceRecord>;
  getInventoryCheckResult(entryId: string): Promise<InventoryCheckRecord | null>;
}
