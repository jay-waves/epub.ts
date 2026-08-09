/*
 * Per-book MathJax SVG cache. Serialized SVG strings are kept by LRU order,
 * capped at 1,500 formulas or roughly 12 MiB, and cleared with the open book.
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

export function clearMathSvgCache() {
  entries.clear();
  totalBytes = 0;
}
