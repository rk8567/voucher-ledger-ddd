import type { VoucherLedgerRepository } from '@/application/repositories/VoucherLedgerRepository';

export type Repositories = Readonly<{
  voucherLedger: VoucherLedgerRepository;
}>;

export interface UnitOfWork {
  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
  readOnly<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
