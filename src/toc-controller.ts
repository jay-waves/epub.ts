import type { FoliateViewElement, TocItem } from "./viewer-types";

export function createTocController(options: {
  tocRoot: HTMLElement;
  tocModal: HTMLDialogElement;
  getCurrentHref: () => string;
  getReaderView: () => FoliateViewElement | null;
}) {
  const updateCurrent = () => {
    const currentHref = options.getCurrentHref();
    for (const link of options.tocRoot.querySelectorAll<HTMLElement>(".toc-link")) {
      link.toggleAttribute("aria-current", Boolean(currentHref && link.dataset.href === currentHref));
    }
  };

  const resetViewState = () => {
    updateCurrent();
    options.tocRoot.scrollTop = 0;

    let firstDetails: HTMLDetailsElement | null = null;
    for (const details of options.tocRoot.querySelectorAll<HTMLDetailsElement>(".toc-collapse")) {
      firstDetails ??= details;
      details.open = false;
    }
    if (firstDetails) firstDetails.open = true;
  };

  const reset = () => {
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

    const list = document.createElement("div");
    list.className = "toc-accordion";
    const normalizedItems = normalizeTocItems(items);
    normalizedItems.forEach((item, index) => {
      list.append(createAccordionItem(item, index));
    });
    options.tocRoot.append(list);
    updateCurrent();
  };

  const navigate = (href?: string) => {
    if (!href) return;
    void options.getReaderView()?.goTo(href);
    options.tocModal.close();
  };

  const createAccordionItem = (item: TocItem, index: number) => {
    const children = item.subitems ?? [];
    const details = document.createElement("details");
    details.className = "collapse toc-collapse";
    details.name = "toc-accordion";
    if (index === 0) details.open = true;

    const summary = document.createElement("summary");
    summary.className = "collapse-title toc-link toc-link-primary";
    summary.dataset.href = item.href ?? "";
    summary.append(createLabel(item.label));
    summary.addEventListener("click", (event) => {
      if (children.length && !details.open) return;
      event.preventDefault();
      navigate(item.href);
    });
    details.append(summary);

    const content = document.createElement("div");
    content.className = "collapse-content toc-collapse-content";
    if (children.length) {
      const childList = document.createElement("div");
      childList.className = "toc-child-list";
      for (const child of children) {
        renderChildItem(child, childList, 0);
      }
      content.append(childList);
    }
    details.append(content);

    return details;
  };

  const renderChildItem = (item: TocItem, parent: HTMLElement, depth: number) => {
    const link = document.createElement("button");
    link.className = "toc-link toc-link-child";
    link.type = "button";
    link.dataset.href = item.href ?? "";
    link.style.setProperty("--toc-depth", String(depth));
    link.append(createLabel(item.label));
    link.addEventListener("click", () => navigate(item.href));
    parent.append(link);

    for (const child of item.subitems ?? []) {
      renderChildItem(child, parent, depth + 1);
    }
  };

  return { render, reset, resetViewState, updateCurrent };
}

function createLabel(label?: string) {
  const text = document.createElement("span");
  text.className = "toc-link-label";
  text.textContent = label ?? "Untitled section";
  return text;
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
