import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { TocItem } from "../foliate";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { TocUpdateDetail } from "../viewer-events";
import { normalizeTocHref } from "../foliate";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

export function TocPage() {
  const [tocState, setTocState] = useState<TocUpdateDetail>({ currentHref: "", items: [] });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useViewerEvent(VIEWER_EVENTS.tocOpen, () => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    scrollCurrentItemIntoView(rootRef.current);
  });
  useViewerEvent(VIEWER_EVENTS.tocUpdate, setTocState);

  useEffect(() => {
    if (dialogRef.current?.open) scrollCurrentItemIntoView(rootRef.current);
  }, [tocState]);

  const navigate = (href?: string) => {
    if (!href) return;
    emitViewerEvent(VIEWER_EVENTS.tocNavigate, href);
    dialogRef.current?.close();
  };

  return (
    <Dialog
      id="toc-modal"
      className="toc-modal-box"
      ref={dialogRef}
    >
      <div className="toc-root" ref={rootRef}>
        {tocState.items.length ? (
          <ul className="toc-menu" key={tocState.currentHref}>
            {tocState.items.map((item, index) => (
              <TocTreeItem
                currentHref={tocState.currentHref}
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
  return normalizeTocHref(linkHref) === normalizeTocHref(currentHref);
}

function scrollCurrentItemIntoView(root: HTMLElement | null) {
  if (!root) return;

  const scrollToCurrent = () => {
    const currentLink = root.querySelector<HTMLElement>('.toc-link[aria-current="page"]');
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
