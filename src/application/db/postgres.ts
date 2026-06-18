import { Pool, type PoolClient } from 'pg';
import pkg from 'pg-connection-string';

export type DbClient = Pick<PoolClient, 'query'>;

export function createPgPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const { parse } = pkg;
  const parsed = parse(connectionString);
  return new Pool({
    ...parsed,
    database: parsed.database ?? undefined,
    host: parsed.host ?? undefined,
    password: process.env.DATABASE_PASSWORD ?? parsed.password ?? undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    ssl: parsed.ssl === true ? true : undefined,
    user: process.env.DATABASE_USER ?? parsed.user ?? undefined,
  });
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
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
