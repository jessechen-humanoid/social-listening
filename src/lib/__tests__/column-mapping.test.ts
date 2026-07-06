import { describe, expect, it } from 'vitest';
import { slimRow, getLogicalFields, guessColumnMapping, validateMapping } from '../column-mapping';

// Spec "Guess patterns cover observed Qsearch column names" — example table
// rows use the real export headers from 麥當勞好感度 Q2.
describe('guessColumnMapping on real export headers', () => {
  it('guesses the comments_from_posts export (no comment URL exists)', () => {
    const columns = ['id', 'message', 'created_time', 'like_count', 'source', 'parentid'];
    const guess = guessColumnMapping(columns, 'comments_from_posts', 'fb');
    expect(guess.content).toBe('message');
    expect(guess.engagement_value).toBe('like_count');
    expect(guess.posted_at).toBe('created_time');
    expect(guess.parent_post_url).toBe('parentid');
  });

  it('guesses the hotcomment export including publish_time', () => {
    const columns = [
      'poster_id', 'poster_name', 'post_id', 'post_permalink', 'post_related_comment_count',
      'id', 'content', 'permalink', 'like_count', 'publish_time',
    ];
    const guess = guessColumnMapping(columns, 'hotcomment', 'fb');
    expect(guess.content).toBe('content');
    expect(guess.engagement_value).toBe('like_count');
    expect(guess.posted_at).toBe('publish_time');
    expect(guess.comment_url).toBe('permalink');
  });
});

// Spec "Comment file mapping without comment URLs"
describe('validateMapping for comments_from_posts', () => {
  it('passes on the real comment export without any comment_url', () => {
    const columns = ['id', 'message', 'created_time', 'like_count', 'source', 'parentid'];
    const result = validateMapping(
      {
        content: 'message',
        engagement_value: 'like_count',
        posted_at: 'created_time',
        parent_post_url: 'parentid',
      },
      'comments_from_posts',
      columns,
      'fb'
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

// Spec "Facebook hotpost author id is required"
describe('platform-aware author_id requirement', () => {
  const columns = ['content', 'engagement_score', 'created_time', 'permalink'];
  const mapping = {
    content: 'content',
    engagement_value: 'engagement_score',
    posted_at: 'created_time',
    post_url: 'permalink',
  };

  it('rejects an fb hotpost mapping without author_id', () => {
    const result = validateMapping(mapping, 'hotpost', columns, 'fb');
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('author_id');
  });

  it('accepts a threads hotpost mapping without author_id', () => {
    const result = validateMapping(mapping, 'hotpost', columns, 'threads');
    expect(result.ok).toBe(true);
  });

  // Spec "Forum hotpost mapping without URLs" (add-multi-platform-batch-upload)
  it('passes a real forum export for dcard hotpost without any post_url', () => {
    const columns = [
      'id', 'comment_content', 'created_time', 'like_count', 'board',
      'parent_id', 'comment_owner_id', 'comment_owner', 'type',
    ];
    const guess = guessColumnMapping(columns, 'hotpost', 'dcard');
    expect(guess.content).toBe('comment_content');
    expect(guess.forum).toBe('board');
    const result = validateMapping(guess, 'hotpost', columns, 'dcard');
    expect(result.ok).toBe(true);
  });

  it('still requires post_url for non-dcard hotpost', () => {
    const result = validateMapping(
      { content: 'content', engagement_value: 'like_count', posted_at: 'created_time' },
      'hotpost',
      ['content', 'like_count', 'created_time'],
      'threads'
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('post_url');
  });

  it('marks author_id required only for fb hotpost field specs', () => {
    const fbSpec = getLogicalFields('hotpost', 'fb').find((f) => f.field === 'author_id');
    const igSpec = getLogicalFields('hotpost', 'ig').find((f) => f.field === 'author_id');
    expect(fbSpec?.required).toBe(true);
    expect(igSpec?.required).toBe(false);
  });
});

// Spec "Upload payload carries only mapped columns".
describe('slimRow', () => {
  it('keeps only mapped columns from a wide row', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) wide[`col_${i}`] = i;
    wide.content = '文字';
    wide.like_count = 42;
    const mapping = {
      content: 'content',
      engagement_value: 'like_count',
      posted_at: 'col_1',
      post_url: 'col_2',
      author_id: 'col_3',
      forum: 'col_4',
    };
    const slim = slimRow(wide, Object.values(mapping));
    expect(Object.keys(slim).sort()).toEqual(
      ['col_1', 'col_2', 'col_3', 'col_4', 'content', 'like_count'].sort()
    );
    expect(slim.content).toBe('文字');
    expect(slim.like_count).toBe(42);
  });

  it('row keys are a subset of the mapping values', () => {
    const row = { a: 1, b: 2, c: 3 };
    const cols = ['a', 'c', undefined, 'missing'];
    const slim = slimRow(row, cols);
    for (const k of Object.keys(slim)) {
      expect(cols).toContain(k);
    }
    expect(slim).toEqual({ a: 1, c: 3 });
  });

  it('undefined and absent columns are skipped without error', () => {
    expect(slimRow({ x: 1 }, [undefined, 'y'])).toEqual({});
  });
});
