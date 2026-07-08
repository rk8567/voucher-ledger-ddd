import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type { PostedLedgerEntryResult, RegisterVoucherMovementCommand } from '@/application/dto';
import { Balance } from '@/domain/balance';
import { DomainError } from '@/domain/errors';
import { assertCanPost } from '@/domain/ledgerPolicies';

export class RegisterVoucherMovementUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(command: RegisterVoucherMovementCommand): Promise<PostedLedgerEntryResult> {
    const balance = Balance.from({ quantities: command.quantities, otherAmountYen: command.otherAmountYen });

    assertCanPost({
      entryTypeCode: command.entryTypeCode,
      transactionCategoryCode: command.transactionCategoryCode,
      branchCode: command.branchCode,
      counterpartyBranchCode: command.counterpartyBranchCode,
      description: command.description,
      value: balance,
    });

    return this.uow.transaction(async ({ voucherLedger }) => {
      const branch = await voucherLedger.lockBranch(command.branchCode);
      if (!branch) throw new DomainError('BRANCH_NOT_FOUND', '拠点が見つかりません', { branchCode: command.branchCode });
      if (!branch.active) throw new DomainError('BRANCH_INACTIVE', '無効な拠点には登録できません', { branchCode: command.branchCode });

      if (!(await voucherLedger.hasOpeningBalance(command.branchCode))) {
        throw new DomainError('OPENING_BALANCE_REQUIRED', '開始時残高を登録してください', { branchCode: command.branchCode });
      }

      if (command.transactionCategoryCode != null) {
        const requiresCounterparty = await voucherLedger.transactionCategoryRequiresCounterparty(command.transactionCategoryCode);
        if (requiresCounterparty && !command.counterpartyBranchCode) {
          throw new DomainError('COUNTERPARTY_BRANCH_REQUIRED', '入出拠点を入力してください', { transactionCategoryCode: command.transactionCategoryCode });
        }
      }

      const dailySequence = await voucherLedger.nextDailySequence(command.branchCode, command.processingDate);
      const draft = await voucherLedger.insertDraftEntry({
        branchCode: command.branchCode,
        departmentCode: command.departmentCode,
        applicationDate: command.applicationDate,
        processingDate: command.processingDate,
        dailySequence,
        entryTypeCode: command.entryTypeCode,
        transactionCategoryCode: command.transactionCategoryCode,
        counterpartyBranchCode: command.counterpartyBranchCode,
        statusCode: command.statusCode,
        companyCode: command.companyCode,
        responsibleEmployeeNo: command.responsibleEmployeeNo,
        description: command.description,
        remarks: command.remarks,
        otherAmountYen: balance.otherAmountYen,
        otherAmountNote: command.otherAmountNote,
        actorEmployeeNo: command.actor?.employeeNo ?? null,
      });

      await voucherLedger.replaceQuantities(draft.id, balance.getQuantities());
      const posted = await voucherLedger.postEntry(draft.id, command.actor?.employeeNo ?? null);
      return { entryId: posted.id, ledgerNo: posted.ledgerNo, amount: balance.toSnapshot() };
    });
  }
}
