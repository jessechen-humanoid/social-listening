import { describe, expect, it } from 'vitest';
import { lastPathSegment, parentKey, postKey } from '../fb-post-key';

// Spec "Facebook parent post matching by normalized key" — the URL formats
// below are the ones observed in real Qsearch exports (麥當勞好感度 Q2).
describe('fb-post-key', () => {
  it('matches the real reel-format permalink against the pageid_postid parentid', () => {
    const key = postKey('931837986851749', 'https://www.facebook.com/reel/1499202668227738/');
    const parent = parentKey('https://www.facebook.com/931837986851749_1499202668227738');
    expect(key).toBe('931837986851749_1499202668227738');
    expect(parent).toBe(key);
  });

  it('handles permalinks with and without a trailing slash identically', () => {
    expect(lastPathSegment('https://www.facebook.com/reel/123/')).toBe('123');
    expect(lastPathSegment('https://www.facebook.com/reel/123')).toBe('123');
    expect(lastPathSegment('https://www.facebook.com/reel/123///')).toBe('123');
  });

  it('handles posts-style permalinks', () => {
    expect(postKey('99', 'https://www.facebook.com/somepage/posts/456')).toBe('99_456');
  });

  it('returns empty keys for missing input instead of throwing', () => {
    expect(lastPathSegment(null)).toBe('');
    expect(lastPathSegment('')).toBe('');
    expect(postKey(null, 'https://x.com/1')).toBe('');
    expect(postKey('1', null)).toBe('');
    expect(parentKey(undefined)).toBe('');
  });
});
