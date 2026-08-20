export function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
