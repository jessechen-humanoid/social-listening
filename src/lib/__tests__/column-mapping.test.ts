import { describe, expect, it } from 'vitest';
import { getLogicalFields, guessColumnMapping, validateMapping } from '../column-mapping';

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

  it('marks author_id required only for fb hotpost field specs', () => {
    const fbSpec = getLogicalFields('hotpost', 'fb').find((f) => f.field === 'author_id');
    const igSpec = getLogicalFields('hotpost', 'ig').find((f) => f.field === 'author_id');
    expect(fbSpec?.required).toBe(true);
    expect(igSpec?.required).toBe(false);
  });
});
