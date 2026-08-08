import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { TocItem } from "../foliate";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { TocUpdateDetail } from "../viewer-events";
import { normalizeTocHref } from "../foliate";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

export function TocPage() {
  const [tocState, setTocState] = useState<TocUpdateDetail>({ currentHref: "", items: [] });
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useViewerEvent(VIEWER_EVENTS.tocOpen, () => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.show();
    setSelectedItemKey(null);
    scrollCurrentItemIntoView(rootRef.current);
  });
  useViewerEvent(VIEWER_EVENTS.tocUpdate, (detail) => {
    setTocState(detail);
    setSelectedItemKey(null);
  });

  useEffect(() => {
    if (dialogRef.current?.open) scrollCurrentItemIntoView(rootRef.current);
  }, [selectedItemKey, tocState]);

  const navigate = (href?: string) => {
    if (!href) return;
    emitViewerEvent(VIEWER_EVENTS.tocNavigate, href);
  };

  return (
    <Dialog
      id="toc-modal"
      className="toc-modal-box"
      ref={dialogRef}
    >
      <div className="toc-root" ref={rootRef}>
        {tocState.items.length ? (
          <ul className="toc-menu">
            {tocState.items.map((item, index) => (
              <TocTreeItem
                currentHref={tocState.currentHref}
                item={item}
                key={`${item.href ?? "section"}-${index}`}
                itemKey={`${index}`}
                depth={0}
                onNavigate={navigate}
                onSelect={setSelectedItemKey}
                selectedItemKey={selectedItemKey}
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
  itemKey,
  onNavigate,
  onSelect,
  selectedItemKey,
}: {
  currentHref: string;
  depth: number;
  item: TocItem;
  itemKey: string;
  onNavigate: (href?: string) => void;
  onSelect: (itemKey: string | null) => void;
  selectedItemKey: string | null;
}) {
  const children = item.subitems ?? [];
  const isCurrent = isMatchingHref(item.href, currentHref);
  const hasCurrentChild = containsHref(children, currentHref);
  const isSelected = selectedItemKey === itemKey || (!selectedItemKey && isCurrent);
  const className = depth === 0 ? "toc-link toc-link-primary" : "toc-link";
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    if (isCurrent || hasCurrentChild) detailsRef.current?.setAttribute("open", "");
  }, [hasCurrentChild, isCurrent]);

  if (children.length) {
    return (
      <li className="toc-list-item">
        <details className="toc-details" ref={detailsRef}>
          <summary
            aria-current={isCurrent ? "page" : undefined}
            className={`${className} toc-summary`}
            data-selected={isSelected ? "true" : undefined}
            onClick={(event) => handleSummaryClick({
              event,
              href: item.href,
              isCurrent,
              isSelected,
              itemKey,
              onNavigate,
              onSelect,
            })}
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
                itemKey={`${itemKey}.${index}`}
                onNavigate={onNavigate}
                onSelect={onSelect}
                selectedItemKey={selectedItemKey}
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
        data-selected={isSelected ? "true" : undefined}
        type="button"
        onClick={() => onNavigate(item.href)}
      >
        <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
      </button>
    </li>
  );
}

function handleSummaryClick({
  event,
  href,
  isCurrent,
  isSelected,
  itemKey,
  onNavigate,
  onSelect,
}: {
  event: MouseEvent<HTMLElement>;
  href: string | undefined;
  isCurrent: boolean;
  isSelected: boolean;
  itemKey: string;
  onNavigate: (href?: string) => void;
  onSelect: (itemKey: string | null) => void;
}) {
  const details = event.currentTarget.parentElement;
  if (!(details instanceof HTMLDetailsElement)) return;

  event.preventDefault();

  if (!details.open || !isSelected) {
    details.open = true;
    onSelect(itemKey);
    return;
  }

  if (isCurrent || !href) {
    details.open = false;
    onSelect(null);
    return;
  }

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
    const currentLink = root.querySelector<HTMLElement>(
      '.toc-link[data-selected="true"], .toc-link[aria-current="page"]',
    );
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
