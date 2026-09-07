import { useCallback, useEffect, useRef, useState } from "react";
import type { DockAction, DockState } from "../model";
import { Button, Tooltip } from "./ui";

import { LayoutTemplate, Palette, Minus, Plus, Minimize2, Maximize2, Save, Search, Info, TableOfContents } from "lucide-react";

const dockItems = [
  {
    action: "toggle-layout",
    label: "Switch to scrolling mode",
    icon: LayoutTemplate,
  },
  {
    action: "open-theme",
    label: "Themes",
    icon: Palette,
  },
  { action: "decrease-font", label: "Decrease font size", icon: Minus },
  { action: "increase-font", label: "Increase font size", icon: Plus },
  { action: "increase-width", label: "Zoom in", icon: Maximize2 },
  { action: "decrease-width", label: "Zoom out", icon: Minimize2 },
  { action: "toggle-search", label: "Search", icon: Search },
  { action: "open-toc", label: "Table of contents", icon: TableOfContents },
  { action: "save-book", label: "Save", icon: Save },
  { action: "open-info", label: "Book information", icon: Info },
] as const;

export function ReaderDock({ onAction, onOpenChange, open, state }: {
  onAction: (action: DockAction) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  state: DockState;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  useEffect(() => {
    setHoverOpen(false);
    return cancelHide;
  }, [state.searchActive, cancelHide]);

  if (state.searchActive) return null;

  return (
    <aside
      aria-label="Reader controls"
      className={`reader-dock-shell${open ? " is-touch-open" : ""}${hoverOpen ? " is-hover-open" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch" || !window.matchMedia("(hover: hover)").matches) return;
        cancelHide();
        setHoverOpen(true);
      }}
      onPointerLeave={() => {
        cancelHide();
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          setHoverOpen(false);
        }, 350);
      }}
    >
      <div className="reader-dock">
        {dockItems.map((item) => {
          const label = getDockItemLabel(item.action, item.label, state);
          const Icon = item.icon;
          const disabled = item.action === "toggle-search" && !state.canSearch
            || item.action === "save-book" && !state.hasUnsavedChanges;

          return (
            <Tooltip key={item.action} label={label} side="right">
              <Button
                aria-label={label}
                disabled={disabled}
                onClick={() => {
                  onOpenChange(false);
                  onAction(item.action);
                }}
              >
                <span className="dock-button-content">
                  <Icon size={20} aria-hidden="true" />
                </span>
              </Button>
            </Tooltip>
          );
        })}
      </div>
    </aside>
  );
}

function getDockItemLabel(action: DockAction, fallback: string, dockState: DockState) {
  if (action === "toggle-layout") return dockState.layoutLabel;
  if (action === "save-book" && dockState.hasUnsavedChanges) return "Save changes";
  return fallback;
}
