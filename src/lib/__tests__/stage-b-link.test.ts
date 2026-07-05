import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Specs "Facebook parent post matching by normalized key" and
// "Giveaway post comment exclusion", exercised against a real database.
describe('runStageBLink', () => {
  let testDb: TestDb;
  let runStageBLink: typeof import('../deep-pipeline/stages').runStageBLink;
  const TASK = 'blink-task';

  async function insertResult(opts: {
    id: string;
    stage: 'A' | 'B';
    content?: string;
    postUrl?: string | null;
    parentPostUrl?: string | null;
    authorId?: string | null;
    filteredOut?: boolean | null;
  }) {
    await testDb.db.query(
      `INSERT INTO task_results
         (result_id, task_id, file_id, row_index, content_text, post_url,
          parent_post_url, author_id, stage_name, filtered_out, status)
       VALUES ($1, $2, 'blink-file', 0, $3, $4, $5, $6, $7, $8, 'pending')`,
      [
        opts.id,
        TASK,
        opts.content ?? 'content',
        opts.postUrl ?? null,
        opts.parentPostUrl ?? null,
        opts.authorId ?? null,
        opts.stage,
        opts.filteredOut ?? null,
      ]
    );
  }

  async function readRow(id: string) {
    const r = await testDb.db.query(
      `SELECT filtered_out, parent_post_url, status FROM task_results WHERE result_id = $1`,
      [id]
    );
    return r.rows[0] as { filtered_out: boolean | null; parent_post_url: string | null; status: string };
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key-never-called';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    runStageBLink = (await import('../deep-pipeline/stages')).runStageBLink;

    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode) VALUES ($1, 'test', 'processing', 'deep')`,
      [TASK]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('blink-file', $1, 'f.xlsx', '{}', 0)`,
      [TASK]
    );

    // A posts: one normal (reel-format URL), one giveaway, one filtered out.
    await insertResult({
      id: 'post-normal', stage: 'A', content: '好吃的薯條',
      postUrl: 'https://www.facebook.com/reel/1499202668227738/', authorId: '931837986851749',
      filteredOut: false,
    });
    await insertResult({
      id: 'post-giveaway', stage: 'A', content: '留言抽獎送大麥克',
      postUrl: 'https://www.facebook.com/reel/2222/', authorId: '931837986851749',
      filteredOut: false,
    });

    // B comments in the real parentid format.
    await insertResult({
      id: 'cmt-matched', stage: 'B',
      parentPostUrl: 'https://www.facebook.com/931837986851749_1499202668227738',
    });
    await insertResult({
      id: 'cmt-exact-url', stage: 'B',
      parentPostUrl: 'https://www.facebook.com/reel/1499202668227738/',
    });
    await insertResult({
      id: 'cmt-giveaway', stage: 'B',
      parentPostUrl: 'https://www.facebook.com/931837986851749_2222',
    });
    await insertResult({
      id: 'cmt-orphan', stage: 'B',
      parentPostUrl: 'https://www.facebook.com/931837986851749_99999',
    });
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('links, rewrites, filters, and excludes giveaway comments per spec', async () => {
    const outcome = await runStageBLink({
      taskId: TASK,
      brandName: '麥當勞',
      prompts: new Map(),
    });

    // Normalized-key match: linked, parent_post_url rewritten to canonical post URL.
    const matched = await readRow('cmt-matched');
    expect(matched.filtered_out).toBe(false);
    expect(matched.parent_post_url).toBe('https://www.facebook.com/reel/1499202668227738/');
    expect(matched.status).toBe('B_link_done');

    // Exact URL equality still matches (backwards compatibility).
    const exact = await readRow('cmt-exact-url');
    expect(exact.filtered_out).toBe(false);

    // Giveaway post comment: matched but excluded; the post itself untouched.
    const giveaway = await readRow('cmt-giveaway');
    expect(giveaway.filtered_out).toBe(true);
    const giveawayPost = await testDb.db.query(
      `SELECT filtered_out FROM task_results WHERE result_id = 'post-giveaway'`
    );
    expect((giveawayPost.rows[0] as { filtered_out: boolean }).filtered_out).toBe(false);

    // No key matches: orphan filtered out.
    const orphan = await readRow('cmt-orphan');
    expect(orphan.filtered_out).toBe(true);

    // Outcome counts: 4 comments in, 2 kept (matched + exact-url).
    expect(outcome.inputCount).toBe(4);
    expect(outcome.outputCount).toBe(2);
  });
});
