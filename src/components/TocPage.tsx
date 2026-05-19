import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { TocItem } from "../viewer-types";
import { VIEWER_EVENTS } from "../viewer-events";
import type { TocNavigateDetail, TocUpdateDetail } from "../viewer-events";
import { Dialog, DialogBackdrop, DialogContent } from "./ui/dialog";

export function TocPage() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [currentHref, setCurrentHref] = useState("");

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const { currentHref: nextCurrentHref, items: nextItems } = (event as CustomEvent<TocUpdateDetail>).detail;
      setCurrentHref(nextCurrentHref);
      setItems(nextItems);
    };

    window.addEventListener(VIEWER_EVENTS.tocUpdate, handleUpdate);
    return () => window.removeEventListener(VIEWER_EVENTS.tocUpdate, handleUpdate);
  }, []);

  return (
    <Dialog id="toc-modal">
      <DialogContent className="toc-modal-box">
        <div id="toc-root" className="toc-root">
          {items.length ? (
            <ul className="toc-menu" key={currentHref}>
              {items.map((item, index) => (
                <TocTreeItem
                  currentHref={currentHref}
                  item={item}
                  key={`${item.href ?? "section"}-${index}`}
                  depth={0}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Open a book to show its table of contents.</p>
          )}
        </div>
      </DialogContent>
      <DialogBackdrop />
    </Dialog>
  );
}

function TocTreeItem({
  currentHref,
  depth,
  item,
}: {
  currentHref: string;
  depth: number;
  item: TocItem;
}) {
  const children = item.subitems ?? [];
  const isCurrent = isMatchingHref(item.href, currentHref);
  const hasCurrentChild = containsHref(children, currentHref);
  const className = depth === 0 ? "toc-link toc-link-primary" : "toc-link";

  if (children.length) {
    return (
      <li className="toc-list-item">
        <details className="toc-details" open={isCurrent || hasCurrentChild}>
          <summary
            aria-current={isCurrent ? "page" : undefined}
            className={`${className} toc-summary`}
            data-current={isCurrent ? "true" : undefined}
            data-href={item.href ?? ""}
            onClick={(event) => handleSummaryClick(event, item.href)}
          >
            <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
          </summary>
          <ul className="toc-child-list">
            {children.map((child, index) => (
              <TocTreeItem
                currentHref={currentHref}
                depth={depth + 1}
                item={child}
                key={`${child.href ?? "section"}-${index}`}
              />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  return (
    <li className="toc-list-item">
      <button
        aria-current={isCurrent ? "page" : undefined}
        className={className}
        data-current={isCurrent ? "true" : undefined}
        data-href={item.href ?? ""}
        type="button"
        onClick={() => navigateToTocItem(item.href)}
      >
        <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
      </button>
    </li>
  );
}

function handleSummaryClick(event: MouseEvent<HTMLElement>, href?: string) {
  const details = event.currentTarget.parentElement;
  if (!(details instanceof HTMLDetailsElement) || !details.open) return;

  event.preventDefault();
  navigateToTocItem(href);
}

function navigateToTocItem(href?: string) {
  if (!href) return;
  window.dispatchEvent(
    new CustomEvent<TocNavigateDetail>(VIEWER_EVENTS.tocNavigate, {
      detail: { href },
    }),
  );
}

function containsHref(items: TocItem[], href: string): boolean {
  return items.some((item) => isMatchingHref(item.href, href) || containsHref(item.subitems ?? [], href));
}

function isMatchingHref(linkHref?: string, currentHref?: string) {
  if (!linkHref || !currentHref) return false;
  if (linkHref === currentHref) return true;
  try {
    const linkUrl = new URL(linkHref, "https://reader.local/");
    const currentUrl = new URL(currentHref, "https://reader.local/");
    return linkUrl.pathname === currentUrl.pathname && linkUrl.hash === currentUrl.hash;
  } catch {
    return false;
  }
}
