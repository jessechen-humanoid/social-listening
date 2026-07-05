import { describe, expect, it } from 'vitest';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';

// Task 3.4: Excel serial date numbers must resolve to real dates instead of
// becoming null (which blanked the weekly timeline for affected files).
describe('toIsoOrNull Excel serial dates', () => {
  it('converts serial 45400 to 2024-04-18 (Excel epoch 1899-12-30)', async () => {
    const { toIsoOrNull } = await import('../deep-pipeline/orchestrator');
    expect(toIsoOrNull(45400)).toBe('2024-04-18T00:00:00.000Z');
  });

  it('still parses ISO strings and rejects garbage', async () => {
    const { toIsoOrNull } = await import('../deep-pipeline/orchestrator');
    expect(toIsoOrNull('2026-04-20T20:24:03+08:00')).toBe('2026-04-20T12:24:03.000Z');
    expect(toIsoOrNull('not a date')).toBeNull();
    expect(toIsoOrNull(null)).toBeNull();
    // Numbers outside the plausible serial range fall through to Date parsing.
    expect(toIsoOrNull(1404017321563495)).toBeNull();
  });
});
