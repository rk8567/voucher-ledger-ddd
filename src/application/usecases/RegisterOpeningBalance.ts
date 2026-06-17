import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type { PostedLedgerEntryResult, RegisterOpeningBalanceCommand } from '@/application/dto';
import { Balance } from '@/domain/balance';
import { DomainError } from '@/domain/errors';
import { EntryTypeCode } from '@/domain/entryTypes';
import { assertCanPost } from '@/domain/ledgerPolicies';

export class RegisterOpeningBalanceUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(command: RegisterOpeningBalanceCommand): Promise<PostedLedgerEntryResult> {
    const balance = Balance.from({ quantities: command.quantities, otherAmountYen: command.otherAmountYen });
    const description = command.description?.trim() || '開始時残高';

    assertCanPost({
      entryTypeCode: EntryTypeCode.OpeningBalance,
      branchCode: command.branchCode,
      description,
      value: balance,
    });

    return this.uow.transaction(async ({ voucherLedger }) => {
      const branch = await voucherLedger.lockBranch(command.branchCode);
      if (!branch) throw new DomainError('BRANCH_NOT_FOUND', '拠点が見つかりません', { branchCode: command.branchCode });
      if (!branch.active) throw new DomainError('BRANCH_INACTIVE', '無効な拠点には登録できません', { branchCode: command.branchCode });

      if (await voucherLedger.hasOpeningBalance(command.branchCode)) {
        throw new DomainError('OPENING_BALANCE_ALREADY_EXISTS', '開始残高は既に登録されています', { branchCode: command.branchCode });
      }

      const draft = await voucherLedger.insertDraftEntry({
        branchCode: command.branchCode,
        periodYear: command.periodYear,
        periodMonth: command.periodMonth,
        applicationDate: command.applicationDate,
        processingDate: command.processingDate,
        dailySequence: 0,
        entryTypeCode: EntryTypeCode.OpeningBalance,
        description,
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
