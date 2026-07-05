// Normalized parent-post matching keys for the FB deep pipeline, replicating
// the original Python pairing rule (link_A_to_B.py):
//   parentid.split('/')[-1] == page_id + '_' + post_url.split('/')[-1]
// Real Qsearch exports carry two different URL shapes that never compare
// equal as strings:
//   post permalink:   https://www.facebook.com/reel/1404017321563495/
//   comment parentid: https://www.facebook.com/931837986851749_1404017321563495

/** Last path segment of a URL, ignoring a trailing slash. Empty string for blank input. */
export function lastPathSegment(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim().replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Matching key for a post: author id + '_' + last segment of its permalink. */
export function postKey(authorId: string | null | undefined, postUrl: string | null | undefined): string {
  const segment = lastPathSegment(postUrl);
  if (!authorId || !segment) return '';
  return `${authorId}_${segment}`;
}

/** Matching key for a comment's parent reference (the parentid column value). */
export function parentKey(parentPostUrl: string | null | undefined): string {
  return lastPathSegment(parentPostUrl);
}
