import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type { CorrectedVoucherMovementInput, IssueRedVoucherCorrectionCommand, RedVoucherCorrectionResult } from '@/application/dto';
import type { VoucherLedgerRepository } from '@/application/repositories/VoucherLedgerRepository';
import { Balance } from '@/domain/balance';
import { DomainError } from '@/domain/errors';
import { isMovementEntryType, reverseMovementEntryType } from '@/domain/entryTypes';
import { assertCanPost } from '@/domain/ledgerPolicies';

export class IssueRedVoucherCorrectionUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(command: IssueRedVoucherCorrectionCommand): Promise<RedVoucherCorrectionResult> {
    return this.uow.transaction(async ({ voucherLedger }) => {
      const original = await voucherLedger.getPostedEntryForUpdateByLedgerNo(command.originalLedgerNo);
      if (!original) {
        throw new DomainError('LEDGER_ENTRY_NOT_FOUND', '元伝票が見つかりません', { originalLedgerNo: command.originalLedgerNo });
      }

      if (!isMovementEntryType(original.entryTypeCode)) {
        throw new DomainError('LEDGER_ENTRY_NOT_CORRECTABLE', 'この伝票区分は赤伝票で訂正できません', {
          ledgerNo: original.ledgerNo,
          entryTypeCode: original.entryTypeCode,
        });
      }

      if (original.redVoucherStatusCode !== 0 || original.reversalLedgerNo !== null) {
        throw new DomainError('LEDGER_ENTRY_ALREADY_CORRECTED', 'この伝票は既に赤伝票処理済みです', { ledgerNo: original.ledgerNo });
      }

      const branch = await voucherLedger.lockBranch(original.branchCode);
      if (!branch) throw new DomainError('BRANCH_NOT_FOUND', '拠点が見つかりません', { branchCode: original.branchCode });
      if (!branch.active) throw new DomainError('BRANCH_INACTIVE', '無効な拠点には登録できません', { branchCode: original.branchCode });

      const actorEmployeeNo = command.actor?.employeeNo ?? null;
      const reversalEntryType = reverseMovementEntryType(original.entryTypeCode);
      const reversalDailySequence = await voucherLedger.nextDailySequence(original.branchCode, command.reversalProcessingDate);

      const reversalDraft = await voucherLedger.insertDraftEntry({
        branchCode: original.branchCode,
        departmentCode: original.departmentCode,
        periodYear: original.periodYear,
        periodMonth: original.periodMonth,
        applicationDate: command.reversalApplicationDate ?? command.reversalProcessingDate,
        processingDate: command.reversalProcessingDate,
        dailySequence: reversalDailySequence,
        entryTypeCode: reversalEntryType,
        transactionCategoryCode: original.transactionCategoryCode,
        counterpartyBranchCode: original.counterpartyBranchCode,
        statusCode: original.statusCode,
        companyCode: original.companyCode,
        responsibleEmployeeNo: actorEmployeeNo ?? original.responsibleEmployeeNo,
        description: command.reversalDescription?.trim() || `No.${original.ledgerNo} の赤伝票`,
        remarks: command.reversalRemarks ?? original.remarks,
        otherAmountYen: original.otherAmountYen,
        otherAmountNote: original.otherAmountNote,
        redVoucherStatusCode: 2,
        originalLedgerNo: original.ledgerNo,
        actorEmployeeNo,
      });

      await voucherLedger.replaceQuantities(reversalDraft.id, original.quantities);
      const reversalPosted = await voucherLedger.postEntry(reversalDraft.id, actorEmployeeNo);
      await voucherLedger.markOriginalWithReversal(original.ledgerNo, reversalPosted.ledgerNo, actorEmployeeNo);

      let correctedEntryId: string | undefined;
      let correctedLedgerNo: number | undefined;

      if (command.correctedEntry) {
        const corrected = await this.postCorrectedEntry(
          voucherLedger,
          original.ledgerNo,
          original.branchCode,
          command.correctedEntry,
          actorEmployeeNo,
        );
        correctedEntryId = corrected.entryId;
        correctedLedgerNo = corrected.ledgerNo;
        await voucherLedger.linkCorrection(original.ledgerNo, reversalPosted.ledgerNo, corrected.ledgerNo, actorEmployeeNo);
      }

      return {
        originalLedgerNo: original.ledgerNo,
        reversalEntryId: reversalPosted.id,
        reversalLedgerNo: reversalPosted.ledgerNo,
        correctedEntryId,
        correctedLedgerNo,
      };
    });
  }

  private async postCorrectedEntry(
    voucherLedger: VoucherLedgerRepository,
    originalLedgerNo: number,
    branchCode: number,
    input: CorrectedVoucherMovementInput,
    actorEmployeeNo: number | null,
  ): Promise<{ entryId: string; ledgerNo: number }> {
    const balance = Balance.from({ quantities: input.quantities, otherAmountYen: input.otherAmountYen });

    assertCanPost({
      entryTypeCode: input.entryTypeCode,
      transactionCategoryCode: input.transactionCategoryCode,
      branchCode,
      counterpartyBranchCode: input.counterpartyBranchCode,
      description: input.description,
      value: balance,
    });

    if (input.transactionCategoryCode != null) {
      const requiresCounterparty = await voucherLedger.transactionCategoryRequiresCounterparty(input.transactionCategoryCode);
      if (requiresCounterparty && !input.counterpartyBranchCode) {
        throw new DomainError('COUNTERPARTY_BRANCH_REQUIRED', '入出拠点を入力してください', {
          transactionCategoryCode: input.transactionCategoryCode,
        });
      }
    }

    const dailySequence = await voucherLedger.nextDailySequence(branchCode, input.processingDate);
    const draft = await voucherLedger.insertDraftEntry({
      branchCode,
      departmentCode: input.departmentCode,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      applicationDate: input.applicationDate,
      processingDate: input.processingDate,
      dailySequence,
      entryTypeCode: input.entryTypeCode,
      transactionCategoryCode: input.transactionCategoryCode,
      counterpartyBranchCode: input.counterpartyBranchCode,
      statusCode: input.statusCode,
      companyCode: input.companyCode,
      responsibleEmployeeNo: input.responsibleEmployeeNo ?? actorEmployeeNo,
      description: input.description,
      remarks: input.remarks,
      otherAmountYen: balance.otherAmountYen,
      otherAmountNote: input.otherAmountNote,
      redVoucherStatusCode: 3,
      originalLedgerNo,
      actorEmployeeNo,
    });

    await voucherLedger.replaceQuantities(draft.id, balance.getQuantities());
    const posted = await voucherLedger.postEntry(draft.id, actorEmployeeNo);

    return { entryId: posted.id, ledgerNo: posted.ledgerNo };
  }
}
