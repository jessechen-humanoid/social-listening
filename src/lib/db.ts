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

// Set-based batched UPDATE: applies (id, ...values) tuples through a single
// UPDATE ... FROM (VALUES ...) statement per chunk instead of one statement
// per row. `setSql` references v.* columns, e.g.
//   batchUpdate('task_results', 'result_id', 'filtered_out = v.val::boolean',
//               ['val'], rows.map(r => [r.id, r.flag]))
export async function batchUpdate(
  table: string,
  idColumn: string,
  setSql: string,
  valueNames: string[],
  tuples: Array<Array<unknown>>,
  chunkSize = 500
): Promise<void> {
  for (let start = 0; start < tuples.length; start += chunkSize) {
    const chunk = tuples.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const values = chunk
      .map((tuple) => {
        const base = params.length;
        params.push(...tuple);
        return `(${tuple.map((_, k) => `$${base + k + 1}`).join(', ')})`;
      })
      .join(', ');
    await query(
      `UPDATE ${table} SET ${setSql}
       FROM (VALUES ${values}) AS v(id, ${valueNames.join(', ')})
       WHERE ${table}.${idColumn} = v.id`,
      params
    );
  }
}

export default pool;
