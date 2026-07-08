import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type { InventoryCheckResult, RegisterInventoryCheckCommand } from '@/application/dto';
import { Balance } from '@/domain/balance';
import { DomainError } from '@/domain/errors';
import { EntryTypeCode } from '@/domain/entryTypes';
import { assertCanPost } from '@/domain/ledgerPolicies';

export class RegisterInventoryCheckUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(command: RegisterInventoryCheckCommand): Promise<InventoryCheckResult> {
    const balance = Balance.from({ quantities: command.quantities, otherAmountYen: command.otherAmountYen });
    const description = command.description?.trim() || '現在有り高チェック';

    assertCanPost({
      entryTypeCode: EntryTypeCode.InventoryCheck,
      branchCode: command.branchCode,
      description,
      value: balance,
    });

    return this.uow.transaction(async ({ voucherLedger }) => {
      const branch = await voucherLedger.lockBranch(command.branchCode);
      if (!branch) throw new DomainError('BRANCH_NOT_FOUND', '拠点が見つかりません', { branchCode: command.branchCode });
      if (!branch.active) throw new DomainError('BRANCH_INACTIVE', '無効な拠点には登録できません', { branchCode: command.branchCode });

      if (!(await voucherLedger.hasOpeningBalance(command.branchCode))) {
        throw new DomainError('OPENING_BALANCE_REQUIRED', '開始時残高を登録してください', { branchCode: command.branchCode });
      }

      const dailySequence = await voucherLedger.nextDailySequence(command.branchCode, command.processingDate);
      const draft = await voucherLedger.insertDraftEntry({
        branchCode: command.branchCode,
        processingDate: command.processingDate,
        dailySequence,
        entryTypeCode: EntryTypeCode.InventoryCheck,
        responsibleEmployeeNo: command.responsibleEmployeeNo,
        description,
        remarks: command.remarks,
        otherAmountYen: balance.otherAmountYen,
        otherAmountNote: command.otherAmountNote,
        actorEmployeeNo: command.actor?.employeeNo ?? null,
      });

      await voucherLedger.replaceQuantities(draft.id, balance.getQuantities());
      const posted = await voucherLedger.postEntry(draft.id, command.actor?.employeeNo ?? null);
      const result = await voucherLedger.getInventoryCheckResult(posted.id);

      if (!result) {
        throw new DomainError('LEDGER_ENTRY_NOT_FOUND', '現在有り高チェック結果を取得できません', { entryId: posted.id });
      }

      return {
        entryId: result.entryId,
        ledgerNo: result.ledgerNo,
        actualTotalAmountYen: result.actualTotalAmountYen,
        expectedTotalAmountYen: result.expectedTotalAmountYen,
        discrepancyAmountYen: result.discrepancyAmountYen,
      };
    });
  }
}
