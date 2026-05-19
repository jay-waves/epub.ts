import type { TocItem } from "./viewer-types";
import { VIEWER_EVENTS } from "./viewer-events";

export function createTocController(options: {
  tocRoot: HTMLElement;
  getCurrentHref: () => string;
}) {
  let tocItems: TocItem[] = [];

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

  const emitUpdate = () => {
    window.dispatchEvent(
      new CustomEvent(VIEWER_EVENTS.tocUpdate, {
        detail: {
          currentHref: options.getCurrentHref(),
          items: tocItems,
        },
      }),
    );
  };

  const updateCurrent = () => {
    const currentHref = options.getCurrentHref();
    emitUpdate();
    return findCurrentLink(currentHref);
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
    tocItems = [];
    emitUpdate();
  };

  const render = (items?: TocItem[]) => {
    tocItems = items?.length ? normalizeTocItems(items) : [];
    emitUpdate();
    updateCurrent();
  };

  return { render, reset, resetViewState, updateCurrent };
}

function findCurrentLink(currentHref: string) {
  return document.querySelector<HTMLElement>(
    `.toc-link[data-current="true"], .toc-summary[data-current="true"], .toc-link[data-href="${CSS.escape(currentHref)}"]`,
  );
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
