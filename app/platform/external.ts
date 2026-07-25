export function openExternal(url: string) {
  try {
    const target = new URL(url, window.location.href);
    if (target.protocol !== "http:" && target.protocol !== "https:") return;
    window.open(target.href, "_blank", "noopener,noreferrer");
  } catch {
    // Ignore malformed or unsafe external targets.
  }
}
