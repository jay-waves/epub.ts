/*
 * Per-book formula LRU. MathJax owns the book's global glyph cache; section
 * documents receive only the glyph DOM they use and release it on unload.
 */

const MAX_ENTRIES = 1_500;
const MAX_BYTES = 12 * 1024 * 1024;

type CacheEntry = {
  bytes: number;
  markup: string;
};

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

export function getCachedMathSvg(key: string) {
  const entry = entries.get(key);
  if (!entry) return null;

  entries.delete(key);
  entries.set(key, entry);
  return entry.markup;
}

export function cacheMathSvg(key: string, markup: string) {
  const previous = entries.get(key);
  if (previous) totalBytes -= previous.bytes;

  const entry = {
    bytes: (key.length + markup.length) * 2,
    markup,
  };
  entries.delete(key);
  entries.set(key, entry);
  totalBytes += entry.bytes;

  while (entries.size > MAX_ENTRIES || totalBytes > MAX_BYTES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    totalBytes -= entries.get(oldestKey)?.bytes ?? 0;
    entries.delete(oldestKey);
  }
}

export function clearBookMathSvgCache() {
  entries.clear();
  totalBytes = 0;
}
