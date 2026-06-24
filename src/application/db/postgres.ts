import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import pkg from 'pg-connection-string';

export type DbClient = Pick<PoolClient, 'query'>;

export function createPgPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const { parse } = pkg;
  const parsed = parse(connectionString);
  const pool = new Pool({
    ...parsed,
    database: parsed.database ?? undefined,
    host: parsed.host ?? undefined,
    password: databasePassword() ?? parsed.password ?? undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    ssl: parsed.ssl === true ? true : undefined,
    user: process.env.DATABASE_USER ?? parsed.user ?? undefined,
  });

  pool.on('connect', (client) => {
    client.query("SET voucher_ledger.legacy_import = 'off'").catch((error: unknown) => {
      console.error('Failed to initialize voucher_ledger.legacy_import for app connection', error);
    });
  });

  return pool;
}

function databasePassword(): string | undefined {
  if (process.env.DATABASE_PASSWORD_FILE) {
    return readFileSync(process.env.DATABASE_PASSWORD_FILE, 'utf8').trimEnd();
  }
  return process.env.DATABASE_PASSWORD;
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL voucher_ledger.legacy_import = 'off'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
