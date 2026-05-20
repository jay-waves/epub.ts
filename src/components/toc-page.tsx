import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { TocItem } from "../viewer-types";
import { VIEWER_EVENTS } from "../viewer-events";
import type { TocNavigateDetail, TocUpdateDetail } from "../viewer-events";
import { Dialog } from "./ui/dialog";

export function TocPage() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [currentHref, setCurrentHref] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = () => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
      scrollCurrentItemIntoView(rootRef.current);
    };

    const handleUpdate = (event: Event) => {
      const { currentHref: nextCurrentHref, items: nextItems } = (event as CustomEvent<TocUpdateDetail>).detail;
      setCurrentHref(nextCurrentHref);
      setItems(nextItems);
    };

    window.addEventListener(VIEWER_EVENTS.tocOpen, open);
    window.addEventListener(VIEWER_EVENTS.tocUpdate, handleUpdate);
    return () => {
      window.removeEventListener(VIEWER_EVENTS.tocOpen, open);
      window.removeEventListener(VIEWER_EVENTS.tocUpdate, handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (dialogRef.current?.open) scrollCurrentItemIntoView(rootRef.current);
  }, [currentHref, items]);

  const navigate = (href?: string) => {
    if (!href) return;
    window.dispatchEvent(
      new CustomEvent<TocNavigateDetail>(VIEWER_EVENTS.tocNavigate, {
        detail: { href },
      }),
    );
    dialogRef.current?.close();
  };

  return (
    <Dialog
      id="toc-modal"
      className="toc-modal-box"
      ref={dialogRef}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const isOutside =
          event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        if (isOutside) event.currentTarget.close();
      }}
    >
      <div id="toc-root" className="toc-root" ref={rootRef}>
        {items.length ? (
          <ul className="toc-menu" key={currentHref}>
            {items.map((item, index) => (
              <TocTreeItem
                currentHref={currentHref}
                item={item}
                key={`${item.href ?? "section"}-${index}`}
                depth={0}
                onNavigate={navigate}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Open a book to show its table of contents.</p>
        )}
      </div>
    </Dialog>
  );
}

function TocTreeItem({
  currentHref,
  depth,
  item,
  onNavigate,
}: {
  currentHref: string;
  depth: number;
  item: TocItem;
  onNavigate: (href?: string) => void;
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
            onClick={(event) => handleSummaryClick(event, item.href, onNavigate)}
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
                onNavigate={onNavigate}
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
        onClick={() => onNavigate(item.href)}
      >
        <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
      </button>
    </li>
  );
}

function handleSummaryClick(event: MouseEvent<HTMLElement>, href: string | undefined, onNavigate: (href?: string) => void) {
  const details = event.currentTarget.parentElement;
  if (!(details instanceof HTMLDetailsElement) || !details.open) return;

  event.preventDefault();
  onNavigate(href);
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

function scrollCurrentItemIntoView(root: HTMLElement | null) {
  if (!root) return;

  const scrollToCurrent = () => {
    const currentLink = root.querySelector<HTMLElement>(".toc-link[data-current=\"true\"], .toc-summary[data-current=\"true\"]");
    if (!currentLink) {
      root.scrollTop = 0;
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const linkRect = currentLink.getBoundingClientRect();
    if (!rootRect.height || !linkRect.height) return;

    const centeredDelta = linkRect.top - rootRect.top - root.clientHeight / 2 + linkRect.height / 2;
    root.scrollTo({
      top: Math.max(0, root.scrollTop + centeredDelta),
      behavior: "auto",
    });
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToCurrent();
      window.setTimeout(scrollToCurrent, 80);
    });
  });
}
