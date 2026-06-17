import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type { CurrentBalanceRecord } from '@/application/repositories/VoucherLedgerRepository';

export class GetBranchCurrentBalanceQuery {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(branchCode: number): Promise<CurrentBalanceRecord> {
    return this.uow.readOnly(async ({ voucherLedger }) => voucherLedger.getCurrentBalance(branchCode));
  }
}
