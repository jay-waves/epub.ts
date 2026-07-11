export function normalizeTocHref(href?: string) {
  if (!href) return "";

  try {
    const url = new URL(href, "https://reader.local/");
    return `${url.pathname}${url.hash}`;
  } catch {
    return href.trim();
  }
}
