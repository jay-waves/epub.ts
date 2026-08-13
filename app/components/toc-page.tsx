import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TocItem } from "../renderer";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { TocUpdateDetail } from "../viewer-events";
import { normalizeTocHref } from "../epub/metadata";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

export function TocPage() {
  const [tocState, setTocState] = useState<TocUpdateDetail>({ currentHref: "", items: [] });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useViewerEvent(VIEWER_EVENTS.tocOpen, () => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setSelectedKey(null);
    scrollCurrentItemIntoView(rootRef.current);
  });
  useViewerEvent(VIEWER_EVENTS.tocUpdate, (detail) => {
    setTocState(detail);
    setSelectedKey(null);
  });

  const currentKey = findCurrentKey(tocState.items, tocState.currentItem, tocState.currentHref);

  useEffect(() => {
    if (dialogRef.current?.open) scrollCurrentItemIntoView(rootRef.current);
  }, [selectedKey, tocState]);

  const navigate = (item: TocItem) => {
    if (!item.href) return;
    emitViewerEvent(VIEWER_EVENTS.tocNavigate, { href: item.href, item });
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
                currentKey={currentKey}
                item={item}
                key={`${item.href ?? "section"}-${index}`}
                itemKey={`${index}`}
                depth={0}
                selectedKey={selectedKey}
                onNavigate={navigate}
                onSelect={setSelectedKey}
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
  currentKey,
  depth,
  item,
  itemKey,
  selectedKey,
  onNavigate,
  onSelect,
}: {
  currentKey: string | null;
  depth: number;
  item: TocItem;
  itemKey: string;
  selectedKey: string | null;
  onNavigate: (item: TocItem) => void;
  onSelect: (itemKey: string) => void;
}) {
  const children = item.subitems ?? [];
  const isCurrent = currentKey === itemKey;
  const hasCurrentChild = currentKey?.startsWith(`${itemKey}.`) ?? false;
  const isSelected = selectedKey === itemKey || (selectedKey === null && isCurrent);
  const className = depth === 0 ? "toc-link toc-link-primary" : "toc-link";
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    if (isCurrent || hasCurrentChild) detailsRef.current?.setAttribute("open", "");
  }, [hasCurrentChild, isCurrent]);

  const handleSummaryClick = () => {
    const details = detailsRef.current;
    if (!details) return;

    if (!details.open) {
      details.open = true;
      return;
    }

    if (isSelected || !item.href) {
      details.open = false;
      return;
    }

    onSelect(itemKey);
    onNavigate(item);
  };

  if (children.length) {
    return (
      <li className="toc-list-item">
        <details className="toc-details" ref={detailsRef}>
          <summary
            aria-current={isCurrent ? "page" : undefined}
            className={`${className} toc-summary`}
            data-selected={isSelected ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              handleSummaryClick();
            }}
          >
            <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
          </summary>
          <ul className="toc-child-list">
            {children.map((child, index) => (
              <TocTreeItem
                currentKey={currentKey}
                depth={depth + 1}
                item={child}
                key={`${child.href ?? "section"}-${index}`}
                itemKey={`${itemKey}.${index}`}
                selectedKey={selectedKey}
                onNavigate={onNavigate}
                onSelect={onSelect}
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
        onClick={() => {
          onSelect(itemKey);
          onNavigate(item);
        }}
      >
        <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
      </button>
    </li>
  );
}

function isMatchingHref(linkHref?: string, currentHref?: string) {
  if (!linkHref || !currentHref) return false;
  return normalizeTocHref(linkHref) === normalizeTocHref(currentHref);
}

function findCurrentKey(items: TocItem[], currentItem?: TocItem | null, currentHref?: string) {
  let hrefMatch: string | null = null;

  const visit = (nodes: TocItem[], parentKey = ""): string | null => {
    for (const [index, item] of nodes.entries()) {
      const itemKey = parentKey ? `${parentKey}.${index}` : `${index}`;
      if (item === currentItem) return itemKey;
      if (hrefMatch === null && isMatchingHref(item.href, currentHref)) hrefMatch = itemKey;
      const childMatch = visit(item.subitems ?? [], itemKey);
      if (childMatch) return childMatch;
    }
    return null;
  };

  return visit(items) ?? hrefMatch;
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
