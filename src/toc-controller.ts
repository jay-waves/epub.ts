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

export function collectSectionHrefs(items: TocItem[], sections: string[] = [], seen = new Set<string>()) {
  for (const item of items) {
    const href = normalizeTocHref(item.href);
    if (href && !seen.has(href)) {
      seen.add(href);
      sections.push(href);
    }
    if (item.subitems?.length) collectSectionHrefs(item.subitems, sections, seen);
  }
  return sections;
}
