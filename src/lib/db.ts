import { Pool, type PoolClient } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Without a listener, an error on an idle client (e.g. the DB server
// restarting) is an uncaught exception that kills the whole process.
pool.on('error', (err) => {
  console.error('pg pool idle client error', err);
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

// Runs fn inside a real transaction on a single pooled connection.
// query() checks out a different connection per call, so issuing
// BEGIN/COMMIT through it does NOT create a transaction — multi-statement
// writes must go through this helper and use the provided client.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('transaction rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
