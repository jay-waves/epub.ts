import type { FoliateViewElement, TocItem } from "./viewer-types";

export function createTocController(options: {
  tocRoot: HTMLElement;
  tocModal: HTMLDialogElement;
  getCurrentHref: () => string;
  getReaderView: () => FoliateViewElement | null;
}) {
  const scrollLinkIntoTocView = (link: HTMLElement) => {
    const rootRect = options.tocRoot.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    if (!rootRect.height || !linkRect.height) return;

    const centeredDelta = linkRect.top - rootRect.top - options.tocRoot.clientHeight / 2 + linkRect.height / 2;
    options.tocRoot.scrollTo({
      top: Math.max(0, options.tocRoot.scrollTop + centeredDelta),
      behavior: "auto",
    });
  };

  const scheduleScrollToCurrent = (link: HTMLElement) => {
    const run = () => scrollLinkIntoTocView(link);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        run();
        window.setTimeout(run, 80);
      });
    });
  };

  const getMatchingHref = (linkHref?: string, currentHref?: string) => {
    if (!linkHref || !currentHref) return false;
    if (linkHref === currentHref) return true;
    try {
      const linkUrl = new URL(linkHref, "https://reader.local/");
      const currentUrl = new URL(currentHref, "https://reader.local/");
      return linkUrl.pathname === currentUrl.pathname && linkUrl.hash === currentUrl.hash;
    } catch {
      return false;
    }
  };

  const updateCurrent = () => {
    const currentHref = options.getCurrentHref();
    let currentLink: HTMLElement | null = null;
    for (const link of options.tocRoot.querySelectorAll<HTMLElement>(".toc-link")) {
      const isCurrent = getMatchingHref(link.dataset.href, currentHref);
      if (isCurrent) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
      if (isCurrent) currentLink = link;
    }
    return currentLink;
  };

  const resetViewState = () => {
    const currentLink = updateCurrent();
    if (currentLink) {
      scheduleScrollToCurrent(currentLink);
      return;
    }

    options.tocRoot.scrollTop = 0;
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

    const list = document.createElement("ul");
    list.className = "menu toc-menu";
    const normalizedItems = normalizeTocItems(items);
    normalizedItems.forEach((item) => {
      list.append(createMenuItem(item, 0));
    });
    options.tocRoot.append(list);
    updateCurrent();
  };

  const navigate = (href?: string) => {
    if (!href) return;
    void options.getReaderView()?.goTo(href);
    options.tocModal.close();
  };

  const createMenuItem = (item: TocItem, depth: number) => {
    const children = item.subitems ?? [];
    const listItem = document.createElement("li");

    const link = document.createElement("button");
    link.className = depth === 0 ? "toc-link toc-link-primary" : "toc-link";
    link.type = "button";
    link.dataset.href = item.href ?? "";
    link.style.setProperty("--toc-depth", String(depth));
    link.append(createLabel(item.label));
    link.addEventListener("click", () => navigate(item.href));
    listItem.append(link);

    if (children.length) {
      const childList = document.createElement("ul");
      childList.className = "toc-child-list";
      for (const child of children) {
        childList.append(createMenuItem(child, depth + 1));
      }
      listItem.append(childList);
    }

    return listItem;
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
