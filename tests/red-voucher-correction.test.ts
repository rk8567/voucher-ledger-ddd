import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnitOfWork, Repositories } from '../src/application/db/UnitOfWork';
import type {
  BranchRecord,
  CurrentBalanceRecord,
  InventoryCheckRecord,
  LedgerEntryListFilter,
  LedgerEntryListRecord,
  LedgerEntryRecord,
  PostedLedgerEntryWithAmounts,
  VoucherLedgerRepository,
} from '../src/application/repositories/VoucherLedgerRepository';
import type { DraftLedgerEntryInput } from '../src/application/dto';
import { IssueRedVoucherCorrectionUseCase } from '../src/application/usecases/IssueRedVoucherCorrection';
import { DomainError } from '../src/domain/errors';
import { EntryTypeCode } from '../src/domain/entryTypes';
import { type QuantitySnapshot, stampAmountYen } from '../src/domain/denominations';

type MutablePostedEntry = Omit<PostedLedgerEntryWithAmounts, 'quantities'> & {
  quantities: QuantitySnapshot;
};

class InMemoryVoucherLedgerRepository implements VoucherLedgerRepository {
  readonly branches = new Map<number, BranchRecord>();
  readonly entries = new Map<number, MutablePostedEntry>();
  readonly drafts = new Map<string, MutablePostedEntry>();
  readonly calls: string[] = [];
  failOnLinkCorrection = false;
  private nextLedgerNoValue = 1000;

  constructor(seed?: MutablePostedEntry[]) {
    this.branches.set(1, { branchCode: 1, branchName: 'Test branch', active: true });
    for (const entry of seed ?? []) this.entries.set(entry.ledgerNo, cloneEntry(entry));
  }

  snapshot(): RepositorySnapshot {
    return {
      branches: new Map(this.branches),
      entries: new Map(Array.from(this.entries, ([ledgerNo, entry]) => [ledgerNo, cloneEntry(entry)])),
      drafts: new Map(Array.from(this.drafts, ([id, entry]) => [id, cloneEntry(entry)])),
      calls: [...this.calls],
      failOnLinkCorrection: this.failOnLinkCorrection,
      nextLedgerNoValue: this.nextLedgerNoValue,
    };
  }

  restore(snapshot: RepositorySnapshot): void {
    this.branches.clear();
    snapshot.branches.forEach((value, key) => this.branches.set(key, value));
    this.entries.clear();
    snapshot.entries.forEach((value, key) => this.entries.set(key, cloneEntry(value)));
    this.drafts.clear();
    snapshot.drafts.forEach((value, key) => this.drafts.set(key, cloneEntry(value)));
    this.calls.splice(0, this.calls.length, ...snapshot.calls);
    this.failOnLinkCorrection = snapshot.failOnLinkCorrection;
    this.nextLedgerNoValue = snapshot.nextLedgerNoValue;
  }

  async lockBranch(branchCode: number): Promise<BranchRecord | null> {
    return this.branches.get(branchCode) ?? null;
  }

  async getBranch(branchCode: number): Promise<BranchRecord | null> {
    return this.branches.get(branchCode) ?? null;
  }

  async transactionCategoryRequiresCounterparty(code: number): Promise<boolean> {
    return code === 1;
  }

  async hasOpeningBalance(): Promise<boolean> {
    return true;
  }

  async nextDailySequence(): Promise<number> {
    return 1;
  }

  async insertDraftEntry(input: DraftLedgerEntryInput): Promise<LedgerEntryRecord> {
    const ledgerNo = this.nextLedgerNoValue++;
    const entry = makeEntry({
      id: `draft-${ledgerNo}`,
      ledgerNo,
      branchCode: input.branchCode,
      departmentCode: input.departmentCode ?? null,
      periodYear: input.periodYear ?? null,
      periodMonth: input.periodMonth ?? null,
      applicationDate: input.applicationDate ?? null,
      processingDate: input.processingDate,
      dailySequence: input.dailySequence,
      entryTypeCode: input.entryTypeCode,
      transactionCategoryCode: input.transactionCategoryCode ?? null,
      counterpartyBranchCode: input.counterpartyBranchCode ?? null,
      statusCode: input.statusCode ?? null,
      companyCode: input.companyCode ?? null,
      responsibleEmployeeNo: input.responsibleEmployeeNo ?? null,
      description: input.description,
      remarks: input.remarks ?? null,
      otherAmountYen: input.otherAmountYen,
      otherAmountNote: input.otherAmountNote ?? null,
      redVoucherStatusCode: input.redVoucherStatusCode ?? 0,
      originalLedgerNo: input.originalLedgerNo ?? null,
      reversalLedgerNo: input.reversalLedgerNo ?? null,
      correctionLedgerNo: input.correctionLedgerNo ?? null,
      postedAt: null,
    });
    this.drafts.set(entry.id, entry);
    this.calls.push(`insert:${entry.ledgerNo}:${entry.entryTypeCode}:${entry.redVoucherStatusCode}`);
    return entry;
  }

  async replaceQuantities(entryId: string, quantities: QuantitySnapshot): Promise<void> {
    const draft = this.drafts.get(entryId);
    if (!draft) throw new Error(`Draft not found: ${entryId}`);
    draft.quantities = { ...quantities };
    this.calls.push(`quantities:${draft.ledgerNo}`);
  }

  async postEntry(entryId: string): Promise<LedgerEntryRecord> {
    const draft = this.drafts.get(entryId);
    if (!draft) throw new Error(`Draft not found: ${entryId}`);
    const stampAmount = stampAmountYen(draft.quantities);
    const posted = {
      ...draft,
      postedAt: '2026-01-01T00:00:00.000Z',
      stampAmountYen: stampAmount,
      totalAmountYen: stampAmount + draft.otherAmountYen,
    };
    this.entries.set(posted.ledgerNo, posted);
    this.drafts.delete(entryId);
    this.calls.push(`post:${posted.ledgerNo}`);
    return posted;
  }

  async getPostedEntryForUpdateByLedgerNo(ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null> {
    const entry = this.entries.get(ledgerNo);
    return entry ? cloneEntry(entry) : null;
  }

  async markOriginalWithReversal(originalLedgerNo: number, reversalLedgerNo: number): Promise<void> {
    const original = this.entries.get(originalLedgerNo);
    if (!original) throw new Error(`Original not found: ${originalLedgerNo}`);
    original.redVoucherStatusCode = 1;
    original.reversalLedgerNo = reversalLedgerNo;
    this.calls.push(`mark:${originalLedgerNo}:${reversalLedgerNo}`);
  }

  async linkCorrection(originalLedgerNo: number, reversalLedgerNo: number, correctionLedgerNo: number): Promise<void> {
    if (this.failOnLinkCorrection) throw new Error('forced link failure');
    const original = this.entries.get(originalLedgerNo);
    const reversal = this.entries.get(reversalLedgerNo);
    if (!original || !reversal) throw new Error('Failed to link correction ledger entry.');
    original.correctionLedgerNo = correctionLedgerNo;
    reversal.correctionLedgerNo = correctionLedgerNo;
    this.calls.push(`link:${originalLedgerNo}:${reversalLedgerNo}:${correctionLedgerNo}`);
  }

  async listLedgerEntries(_filter: LedgerEntryListFilter): Promise<LedgerEntryListRecord> {
    return { items: [], totalCount: 0, nextCursorLedgerNo: null };
  }

  async getLedgerEntryByLedgerNo(): Promise<PostedLedgerEntryWithAmounts | null> {
    return null;
  }

  async getCurrentBalance(branchCode: number): Promise<CurrentBalanceRecord> {
    return {
      branchCode,
      asOfLedgerNo: null,
      runningStampAmountYen: 0,
      runningOtherAmountYen: 0,
      runningTotalAmountYen: 0,
      denominations: [],
    };
  }

  async getInventoryCheckResult(): Promise<InventoryCheckRecord | null> {
    return null;
  }
}

type RepositorySnapshot = {
  branches: Map<number, BranchRecord>;
  entries: Map<number, MutablePostedEntry>;
  drafts: Map<string, MutablePostedEntry>;
  calls: string[];
  failOnLinkCorrection: boolean;
  nextLedgerNoValue: number;
};

class InMemoryUnitOfWork implements UnitOfWork {
  constructor(readonly voucherLedger: InMemoryVoucherLedgerRepository) {}

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const snapshot = this.voucherLedger.snapshot();
    try {
      return await work({ voucherLedger: this.voucherLedger });
    } catch (error) {
      this.voucherLedger.restore(snapshot);
      throw error;
    }
  }

  async readOnly<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return work({ voucherLedger: this.voucherLedger });
  }
}

test('red-voucher correction posts reversal and corrected rows atomically', async () => {
  const original = makeEntry({
    ledgerNo: 10,
    entryTypeCode: EntryTypeCode.Incoming,
    quantities: { 84: 2, 10: 1 },
    otherAmountYen: 50,
  });
  const repo = new InMemoryVoucherLedgerRepository([original]);
  const useCase = new IssueRedVoucherCorrectionUseCase(new InMemoryUnitOfWork(repo));

  const result = await useCase.execute({
    originalLedgerNo: 10,
    reversalProcessingDate: '2026-01-10',
    correctedEntry: {
      processingDate: '2026-01-10',
      entryTypeCode: EntryTypeCode.Outgoing,
      description: 'corrected movement',
      quantities: { 84: 1 },
      otherAmountYen: 0,
    },
    actor: { employeeNo: 123 },
  });

  assert.equal(result.originalLedgerNo, 10);
  assert.equal(result.reversalLedgerNo, 1000);
  assert.equal(result.correctedLedgerNo, 1001);
  assert.equal(repo.entries.get(10)?.redVoucherStatusCode, 1);
  assert.equal(repo.entries.get(10)?.reversalLedgerNo, 1000);
  assert.equal(repo.entries.get(10)?.correctionLedgerNo, 1001);

  const reversal = repo.entries.get(1000);
  assert.equal(reversal?.entryTypeCode, EntryTypeCode.Outgoing);
  assert.equal(reversal?.redVoucherStatusCode, 2);
  assert.equal(reversal?.originalLedgerNo, 10);
  assert.deepEqual(reversal?.quantities, original.quantities);
  assert.equal(reversal?.otherAmountYen, original.otherAmountYen);

  const corrected = repo.entries.get(1001);
  assert.equal(corrected?.entryTypeCode, EntryTypeCode.Outgoing);
  assert.equal(corrected?.redVoucherStatusCode, 3);
  assert.equal(corrected?.originalLedgerNo, 10);
  assert.deepEqual(corrected?.quantities, { 84: 1 });
});

test('red-voucher correction rejects already corrected originals', async () => {
  const repo = new InMemoryVoucherLedgerRepository([
    makeEntry({
      ledgerNo: 10,
      entryTypeCode: EntryTypeCode.Incoming,
      redVoucherStatusCode: 1,
      reversalLedgerNo: 1000,
      quantities: { 84: 1 },
    }),
  ]);
  const useCase = new IssueRedVoucherCorrectionUseCase(new InMemoryUnitOfWork(repo));

  await assert.rejects(
    useCase.execute({
      originalLedgerNo: 10,
      reversalProcessingDate: '2026-01-10',
    }),
    (error) => error instanceof DomainError && error.code === 'LEDGER_ENTRY_ALREADY_CORRECTED',
  );
});

test('red-voucher correction rolls back reversal when correction linking fails', async () => {
  const original = makeEntry({
    ledgerNo: 10,
    entryTypeCode: EntryTypeCode.Incoming,
    quantities: { 84: 1 },
    otherAmountYen: 10,
  });
  const repo = new InMemoryVoucherLedgerRepository([original]);
  repo.failOnLinkCorrection = true;
  const useCase = new IssueRedVoucherCorrectionUseCase(new InMemoryUnitOfWork(repo));

  await assert.rejects(
    useCase.execute({
      originalLedgerNo: 10,
      reversalProcessingDate: '2026-01-10',
      correctedEntry: {
        processingDate: '2026-01-10',
        entryTypeCode: EntryTypeCode.Outgoing,
        description: 'corrected movement',
        quantities: { 84: 1 },
      },
    }),
    /forced link failure/,
  );

  assert.deepEqual(Array.from(repo.entries.keys()), [10]);
  assert.equal(repo.entries.get(10)?.redVoucherStatusCode, 0);
  assert.equal(repo.entries.get(10)?.reversalLedgerNo, null);
  assert.equal(repo.drafts.size, 0);
});

function makeEntry(overrides: Partial<MutablePostedEntry> & { ledgerNo: number }): MutablePostedEntry {
  const quantities = overrides.quantities ?? {};
  const stampAmount = stampAmountYen(quantities);
  const otherAmountYen = overrides.otherAmountYen ?? 0;
  return {
    id: overrides.id ?? `entry-${overrides.ledgerNo}`,
    ledgerNo: overrides.ledgerNo,
    branchCode: overrides.branchCode ?? 1,
    branchName: overrides.branchName ?? 'Test branch',
    departmentCode: overrides.departmentCode ?? null,
    departmentName: overrides.departmentName ?? null,
    periodYear: overrides.periodYear ?? null,
    periodMonth: overrides.periodMonth ?? null,
    applicationDate: overrides.applicationDate ?? null,
    processingDate: overrides.processingDate ?? '2026-01-01',
    dailySequence: overrides.dailySequence ?? 1,
    entryTypeCode: overrides.entryTypeCode ?? EntryTypeCode.Incoming,
    entryTypeName: overrides.entryTypeName ?? null,
    transactionCategoryCode: overrides.transactionCategoryCode ?? null,
    transactionCategoryName: overrides.transactionCategoryName ?? null,
    counterpartyBranchCode: overrides.counterpartyBranchCode ?? null,
    counterpartyBranchName: overrides.counterpartyBranchName ?? null,
    statusCode: overrides.statusCode ?? null,
    companyCode: overrides.companyCode ?? null,
    companyName: overrides.companyName ?? null,
    responsibleEmployeeNo: overrides.responsibleEmployeeNo ?? null,
    responsibleEmployeeName: overrides.responsibleEmployeeName ?? null,
    description: overrides.description ?? 'entry',
    remarks: overrides.remarks ?? null,
    otherAmountYen,
    otherAmountNote: overrides.otherAmountNote ?? null,
    redVoucherStatusCode: overrides.redVoucherStatusCode ?? 0,
    redVoucherStatusName: overrides.redVoucherStatusName ?? null,
    originalLedgerNo: overrides.originalLedgerNo ?? null,
    reversalLedgerNo: overrides.reversalLedgerNo ?? null,
    correctionLedgerNo: overrides.correctionLedgerNo ?? null,
    isDeleted: overrides.isDeleted ?? false,
    legacyRegisteredButtonClicked: overrides.legacyRegisteredButtonClicked ?? true,
    registeredAt: overrides.registeredAt ?? null,
    registeredByEmployeeNo: overrides.registeredByEmployeeNo ?? null,
    registeredByEmployeeName: overrides.registeredByEmployeeName ?? null,
    updatedAt: overrides.updatedAt ?? null,
    updatedByEmployeeNo: overrides.updatedByEmployeeNo ?? null,
    updatedByEmployeeName: overrides.updatedByEmployeeName ?? null,
    postedAt: overrides.postedAt ?? '2026-01-01T00:00:00.000Z',
    filemakerCreatedAt: overrides.filemakerCreatedAt ?? null,
    filemakerCreatedBy: overrides.filemakerCreatedBy ?? null,
    filemakerModifiedAt: overrides.filemakerModifiedAt ?? null,
    filemakerModifiedBy: overrides.filemakerModifiedBy ?? null,
    filemakerLoginEmployeeNo: overrides.filemakerLoginEmployeeNo ?? null,
    filemakerLoginEmployeeName: overrides.filemakerLoginEmployeeName ?? null,
    createdAt: overrides.createdAt ?? null,
    quantities: { ...quantities },
    stampAmountYen: overrides.stampAmountYen ?? stampAmount,
    totalAmountYen: overrides.totalAmountYen ?? stampAmount + otherAmountYen,
  };
}

function cloneEntry(entry: MutablePostedEntry): MutablePostedEntry {
  return {
    ...entry,
    quantities: { ...entry.quantities },
  };
}
