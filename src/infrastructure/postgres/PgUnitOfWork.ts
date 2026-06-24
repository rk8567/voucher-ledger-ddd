import type { Pool } from 'pg';
import type { Repositories, UnitOfWork } from '@/application/db/UnitOfWork';
import { connectAppClient, withTransaction } from '@/application/db/postgres';
import { PgVoucherLedgerRepository } from '@/infrastructure/postgres/PgVoucherLedgerRepository';

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, async (client) => {
      return work({ voucherLedger: new PgVoucherLedgerRepository(client) });
    });
  }

  async readOnly<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const client = await connectAppClient(this.pool);
    try {
      return await work({ voucherLedger: new PgVoucherLedgerRepository(client) });
    } finally {
      client.release();
    }
  }
}
