// Export sanitization (specs "One-click chart bundle download" + "Scored data
// report export"): zip entry names / download filenames may derive from
// client-supplied strings, and CSV cells carry externally-authored social
// comments — both are untrusted.

// Remove path separators, `..` sequences, control chars and Windows-reserved
// characters. An empty result falls back to a fixed name so a hostile input
// can never produce an empty or dot-only filename.
export function sanitizeFilename(name: string, fallback = 'export'): string {
  const cleaned = name
    .replace(/[/\\]/g, '')
    .replace(/\.\./g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[<>:"|?*]/g, '')
    .trim();
  // A name of only dots would still traverse on some unzip tools.
  if (!cleaned || /^\.+$/.test(cleaned)) return fallback;
  return cleaned;
}

// Prefix a single quote when the first character would make a spreadsheet
// evaluate the cell as a formula (Excel: = + - @, plus TAB/CR variants).
export function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}
