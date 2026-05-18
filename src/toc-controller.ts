import { createTOCView } from "foliate-js/ui/tree.js";
import type { FoliateViewElement, TocItem, TocView } from "./viewer-types";

export function createTocController(options: {
  tocRoot: HTMLElement;
  tocModal: HTMLDialogElement;
  getCurrentHref: () => string;
  getReaderView: () => FoliateViewElement | null;
}) {
  let tocView: TocView | null = null;

  const updateCurrent = () => {
    const currentHref = options.getCurrentHref();
    if (currentHref) tocView?.setCurrentHref(currentHref);
  };

  const reset = () => {
    tocView = null;
    options.tocRoot.replaceChildren();
  };

  const render = (items?: TocItem[]) => {
    reset();

    if (!items?.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "This book has no available table of contents.";
      options.tocRoot.append(empty);
      return;
    }

    const view = createTOCView(normalizeTocItems(items), (href: string) => {
      void options.getReaderView()?.goTo(href);
      options.tocModal.close();
    });
    tocView = view;

    const element = view.element as HTMLOListElement;
    element.className = "toc-list";
    for (const item of element.querySelectorAll('[role="treeitem"]')) {
      const treeItem = item as HTMLElement;
      treeItem.classList.add("toc-link");
      if (treeItem.hasAttribute("aria-expanded")) treeItem.setAttribute("aria-expanded", "true");
    }
    options.tocRoot.append(element);
    updateCurrent();
  };

  return { render, reset, updateCurrent };
}

function normalizeTocItems(items: TocItem[]): TocItem[] {
  return items.map((item) => {
    const subitems = item.subitems?.length ? item.subitems : item.children?.length ? item.children : item.items;
    return {
      label: item.label?.trim() || "Untitled section",
      href: item.href,
      subitems: subitems?.length ? normalizeTocItems(subitems) : undefined,
    };
  });
}
