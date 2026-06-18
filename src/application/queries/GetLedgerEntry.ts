import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type { PostedLedgerEntryWithAmounts } from '@/application/repositories/VoucherLedgerRepository';

export class GetLedgerEntryQuery {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(ledgerNo: number): Promise<PostedLedgerEntryWithAmounts | null> {
    return this.uow.readOnly(async ({ voucherLedger }) => voucherLedger.getLedgerEntryByLedgerNo(ledgerNo));
  }
}
