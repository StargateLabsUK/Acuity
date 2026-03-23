/**
 * Renders a structured field value. If the value is an object (e.g. ATMIST sub-fields),
 * it renders each key-value pair on its own line instead of showing raw JSON.
 */
export function renderStructuredValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v !== 'object') return String(v);
  // Object: flatten to "Key: Value" lines
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return '—';
  return entries
    .map(([k, val]) => `${k}: ${val == null ? '—' : String(val)}`)
    .join('\n');
}
