// Pure comparison of two files' column header sets (spec "Multiple files per
// role slot"): all files sharing a slot must have identical headers, because
// one column mapping is applied to all of them. Order is irrelevant.
export interface HeaderComparison {
  same: boolean;
  /** Headers the first file has that the new file lacks. */
  missing: string[];
  /** Headers the new file has that the first file lacks. */
  extra: string[];
}

export function compareHeaderSets(first: string[], incoming: string[]): HeaderComparison {
  const a = new Set(first);
  const b = new Set(incoming);
  const missing = [...a].filter((h) => !b.has(h));
  const extra = [...b].filter((h) => !a.has(h));
  return { same: missing.length === 0 && extra.length === 0, missing, extra };
}

export function describeHeaderMismatch(cmp: HeaderComparison): string {
  const parts: string[] = [];
  if (cmp.missing.length > 0) parts.push(`缺少欄位：${cmp.missing.join('、')}`);
  if (cmp.extra.length > 0) parts.push(`多出欄位：${cmp.extra.join('、')}`);
  return parts.join('；');
}
