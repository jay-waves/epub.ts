import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TocItem } from "../foliate";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { TocUpdateDetail } from "../viewer-events";
import { normalizeTocHref } from "../foliate";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

type TocInteraction = {
  itemKey: string;
  phase: "expanded" | "navigated";
} | null;

export function TocPage() {
  const [tocState, setTocState] = useState<TocUpdateDetail>({ currentHref: "", items: [] });
  const [interaction, setInteraction] = useState<TocInteraction>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useViewerEvent(VIEWER_EVENTS.tocOpen, () => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setInteraction(null);
    scrollCurrentItemIntoView(rootRef.current);
  });
  useViewerEvent(VIEWER_EVENTS.tocUpdate, (detail) => {
    setTocState(detail);
    setInteraction((current) => current?.phase === "navigated" ? current : null);
  });

  useEffect(() => {
    if (dialogRef.current?.open) scrollCurrentItemIntoView(rootRef.current);
  }, [interaction, tocState]);

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
                interaction={interaction}
                onNavigate={navigate}
                onInteractionChange={setInteraction}
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
  interaction,
  onNavigate,
  onInteractionChange,
}: {
  currentHref: string;
  depth: number;
  item: TocItem;
  itemKey: string;
  interaction: TocInteraction;
  onNavigate: (href?: string) => void;
  onInteractionChange: (interaction: TocInteraction) => void;
}) {
  const children = item.subitems ?? [];
  const isCurrent = isMatchingHref(item.href, currentHref);
  const hasCurrentChild = containsHref(children, currentHref);
  const isSelected = interaction?.itemKey === itemKey || (!interaction && isCurrent);
  const className = depth === 0 ? "toc-link toc-link-primary" : "toc-link";
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    if (isCurrent || hasCurrentChild) detailsRef.current?.setAttribute("open", "");
  }, [hasCurrentChild, isCurrent]);

  const handleSummaryClick = () => {
    const details = detailsRef.current;
    if (!details) return;

    if (!details.open || !isSelected) {
      details.open = true;
      onInteractionChange({ itemKey, phase: "expanded" });
      return;
    }

    if (interaction?.phase === "navigated" || isCurrent || !item.href) {
      details.open = false;
      onInteractionChange(null);
      return;
    }

    onInteractionChange({ itemKey, phase: "navigated" });
    onNavigate(item.href);
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
                currentHref={currentHref}
                depth={depth + 1}
                item={child}
                key={`${child.href ?? "section"}-${index}`}
                itemKey={`${itemKey}.${index}`}
                interaction={interaction}
                onNavigate={onNavigate}
                onInteractionChange={onInteractionChange}
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
          onInteractionChange(null);
          onNavigate(item.href);
        }}
      >
        <span className="toc-link-label">{item.label ?? "Untitled section"}</span>
      </button>
    </li>
  );
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
