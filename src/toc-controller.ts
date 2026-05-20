import type { TocItem } from "./viewer-types";

export function normalizeTocHref(href?: string) {
  if (!href) return "";

  try {
    const url = new URL(href, "https://reader.local/");
    return `${url.pathname}${url.hash}`;
  } catch {
    return href.trim();
  }
}

export function normalizeTocItems(items: TocItem[] = []): TocItem[] {
  return items.map((item) => {
    const subitems = item.subitems?.length ? item.subitems : item.children?.length ? item.children : item.items;
    return {
      label: item.label?.trim() || "Untitled section",
      href: item.href,
      subitems: subitems?.length ? normalizeTocItems(subitems) : undefined,
    };
  });
}
