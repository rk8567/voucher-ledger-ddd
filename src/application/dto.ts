import type { QuantityInput, QuantitySnapshot } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import type { RedVoucherStatusCode } from '@/domain/redVoucherStatuses';

export type ActorContext = Readonly<{
  employeeNo?: number | null;
}>;

export type RegisterOpeningBalanceCommand = Readonly<{
  branchCode: number;
  processingDate: string;
  periodYear?: number | null;
  periodMonth?: number | null;
  applicationDate?: string | null;
  quantities: QuantityInput;
  otherAmountYen?: number;
  otherAmountNote?: string | null;
  description?: string | null;
  remarks?: string | null;
  actor?: ActorContext;
}>;

export type RegisterVoucherMovementCommand = Readonly<{
  branchCode: number;
  processingDate: string;
  applicationDate?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  entryTypeCode: EntryTypeCode.Incoming | EntryTypeCode.Outgoing | EntryTypeCode.IncomingAlt | EntryTypeCode.OutgoingAlt;
  transactionCategoryCode?: number | null;
  counterpartyBranchCode?: number | null;
  companyCode?: number | null;
  departmentCode?: number | null;
  responsibleEmployeeNo?: number | null;
  statusCode?: number | null;
  description: string;
  remarks?: string | null;
  quantities: QuantityInput;
  otherAmountYen?: number;
  otherAmountNote?: string | null;
  actor?: ActorContext;
}>;

export type RegisterInventoryCheckCommand = Readonly<{
  branchCode: number;
  processingDate: string;
  applicationDate?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  responsibleEmployeeNo?: number | null;
  description?: string | null;
  remarks?: string | null;
  quantities: QuantityInput;
  otherAmountYen?: number;
  otherAmountNote?: string | null;
  actor?: ActorContext;
}>;

export type CorrectedVoucherMovementInput = Readonly<{
  processingDate: string;
  applicationDate?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  entryTypeCode: EntryTypeCode.Incoming | EntryTypeCode.Outgoing | EntryTypeCode.IncomingAlt | EntryTypeCode.OutgoingAlt;
  transactionCategoryCode?: number | null;
  counterpartyBranchCode?: number | null;
  companyCode?: number | null;
  departmentCode?: number | null;
  responsibleEmployeeNo?: number | null;
  statusCode?: number | null;
  description: string;
  remarks?: string | null;
  quantities: QuantityInput;
  otherAmountYen?: number;
  otherAmountNote?: string | null;
}>;

export type IssueRedVoucherCorrectionCommand = Readonly<{
  originalLedgerNo: number;
  reversalProcessingDate: string;
  reversalApplicationDate?: string | null;
  reversalDescription?: string | null;
  reversalRemarks?: string | null;
  correctedEntry?: CorrectedVoucherMovementInput | null;
  actor?: ActorContext;
}>;

export type DraftLedgerEntryInput = Readonly<{
  branchCode: number;
  departmentCode?: number | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  applicationDate?: string | null;
  processingDate: string;
  dailySequence: number;
  entryTypeCode: EntryTypeCode;
  transactionCategoryCode?: number | null;
  counterpartyBranchCode?: number | null;
  statusCode?: number | null;
  companyCode?: number | null;
  responsibleEmployeeNo?: number | null;
  description: string;
  remarks?: string | null;
  otherAmountYen: number;
  otherAmountNote?: string | null;
  redVoucherStatusCode?: RedVoucherStatusCode | null;
  originalLedgerNo?: number | null;
  reversalLedgerNo?: number | null;
  correctionLedgerNo?: number | null;
  actorEmployeeNo?: number | null;
}>;

export type PostedLedgerEntryResult = Readonly<{
  entryId: string;
  ledgerNo: number;
  amount: Readonly<{
    quantities: QuantitySnapshot;
    stampAmountYen: number;
    otherAmountYen: number;
    totalAmountYen: number;
  }>;
}>;

export type InventoryCheckResult = Readonly<{
  entryId: string;
  ledgerNo: number;
  actualTotalAmountYen: number;
  expectedTotalAmountYen: number;
  discrepancyAmountYen: number;
}>;

export type RedVoucherCorrectionResult = Readonly<{
  originalLedgerNo: number;
  reversalEntryId: string;
  reversalLedgerNo: number;
  correctedEntryId?: string;
  correctedLedgerNo?: number;
}>;
