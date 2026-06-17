import { createPgPool } from '@/application/db/postgres';
import { PgUnitOfWork } from '@/infrastructure/postgres/PgUnitOfWork';

const globalForPg = globalThis as unknown as {
  voucherLedgerPool?: ReturnType<typeof createPgPool>;
};

export const pgPool = globalForPg.voucherLedgerPool ?? createPgPool();

if (process.env.NODE_ENV !== 'production') {
  globalForPg.voucherLedgerPool = pgPool;
}

export const unitOfWork = new PgUnitOfWork(pgPool);
