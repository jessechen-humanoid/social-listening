// Boots an isolated real PostgreSQL (embedded-postgres) for integration tests,
// points DATABASE_URL at it, then imports src/lib/db so its pool connects to
// the test instance. Never touches the developer's real database.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestDb {
  db: typeof import('../db');
  /** The underlying server, exposed so tests can simulate a DB outage. */
  pg: InstanceType<typeof EmbeddedPostgres>;
  stop: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  // Vitest workers are separate processes; a pid-derived port avoids collisions
  // between test files starting their own instances in parallel.
  const port = 54000 + (process.pid % 1000);
  const pg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), 'sl-test-pg-')),
    user: 'sl_test',
    password: 'sl_test',
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('sl_test');

  process.env.DATABASE_URL = `postgresql://sl_test:sl_test@localhost:${port}/sl_test`;
  const db = await import('../db');

  return {
    db,
    pg,
    stop: async () => {
      try {
        await db.default.end();
      } catch {
        // Pool may already be unusable if the test killed the server.
      }
      try {
        await pg.stop();
      } catch {
        // Server may already be stopped by the test.
      }
    },
  };
}
