import { describe, expect, it } from 'vitest';
import { sanitizeCsvCell, sanitizeFilename } from '../sanitize-export';

// Specs "One-click chart bundle download" (entry names) and
// "Scored data report export" (formula neutralization).
describe('sanitizeFilename', () => {
  it('strips path traversal from zip entry names', () => {
    expect(sanitizeFilename('../../evil.png')).toBe('evil.png');
  });

  it('strips separators, control chars and reserved characters', () => {
    expect(sanitizeFilename('a/b\\c:d"e|f?g*h<i>jk.png')).toBe('abcdefghijk.png');
  });

  it('falls back on empty or dot-only results', () => {
    expect(sanitizeFilename('../..')).toBe('export');
    expect(sanitizeFilename('///')).toBe('export');
    expect(sanitizeFilename('', 'charts')).toBe('charts');
  });

  it('keeps ordinary names (including Chinese project names) intact', () => {
    expect(sanitizeFilename('麥當勞 2026 Q2 測試')).toBe('麥當勞 2026 Q2 測試');
    expect(sanitizeFilename('scatter.png')).toBe('scatter.png');
  });
});

describe('sanitizeCsvCell', () => {
  it('neutralizes formula-leading characters', () => {
    expect(sanitizeCsvCell('=IMPORTXML("http://x","//a")')).toBe(`'=IMPORTXML("http://x","//a")`);
    expect(sanitizeCsvCell('+1+1')).toBe(`'+1+1`);
    expect(sanitizeCsvCell('-2+3')).toBe(`'-2+3`);
    expect(sanitizeCsvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(sanitizeCsvCell('\tX')).toBe(`'\tX`);
    expect(sanitizeCsvCell('\rX')).toBe(`'\rX`);
  });

  it('leaves normal comment text untouched', () => {
    expect(sanitizeCsvCell('麥當勞的薯條就是讚 =)')).toBe('麥當勞的薯條就是讚 =)');
    expect(sanitizeCsvCell('')).toBe('');
  });
});
