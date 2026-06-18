import type { UnitOfWork } from '@/application/db/UnitOfWork';
import type {
  LedgerEntryListFilter,
  LedgerEntryListRecord,
} from '@/application/repositories/VoucherLedgerRepository';

export class ListLedgerEntriesQuery {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(filter: LedgerEntryListFilter = {}): Promise<LedgerEntryListRecord> {
    return this.uow.readOnly(async ({ voucherLedger }) => voucherLedger.listLedgerEntries(filter));
  }
}
