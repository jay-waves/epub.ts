import type { TocItem } from "./viewer-types";

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
