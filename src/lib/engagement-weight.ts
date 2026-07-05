// Single source of truth for the engagement weight (OPTIMIZATION-PLAN.md
// appendix D decision, 2026-07-03): weight = sqrt(engagement + 1).
// Semantics: the author counts as one voice, each engagement adds an endorser —
// so zero-engagement (and NULL-engagement) rows carry weight 1 instead of
// vanishing from the statistics like in the original Python sqrt(e).
// Used by both the aggregate stage and the scatter plot's deep mode; keep them
// on this function so the chart and the numbers can never drift apart.
export function engagementWeight(engagement: number | null | undefined): number {
  const n = Number(engagement ?? 0);
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  return Math.sqrt(safe + 1);
}
