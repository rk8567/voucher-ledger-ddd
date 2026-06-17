import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import pkg from 'pg-connection-string';

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  return url;
}

export function createPool(): Pool {
    const { parse } = pkg;
    const dbConfig = parse(requireDatabaseUrl());
    dbConfig.user = process.env.DATABASE_USER ?? "postgres"; // FIXME: nullable string in config
    dbConfig.password = process.env.DATABASE_PASSWORD;
    return new Pool(dbConfig);
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

export async function runSqlFile(client: PoolClient, filePath: string): Promise<void> {
  const sql = readFileSync(filePath, 'utf8');
  await client.query(sql);
}

export async function runSchemaMigrations(pool: Pool, migrationsDir: string, options?: { through?: string }): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  const selected = options?.through
    ? files.filter((name) => name <= options.through!)
    : files.filter((name) => !name.startsWith('005_'));

  for (const file of selected) {
    const path = join(migrationsDir, file);
    const client = await pool.connect();
    try {
      console.log(`Applying ${file}...`);
      await runSqlFile(client, path);
    } finally {
      client.release();
    }
  }
}

export async function queryCount(pool: Pool, sql: string): Promise<number> {
  const result = await pool.query<QueryResultRow & { count: string }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}
