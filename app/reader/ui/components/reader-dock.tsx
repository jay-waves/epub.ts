import { useState } from "react";
import { emitViewerEvent, VIEWER_EVENTS } from "../../events";
import type { DockAction, DockUpdateDetail } from "../../events";
import { Button, Tooltip } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

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

export function ReaderDock() {
  const [touchOpen, setTouchOpen] = useState(false);
  const [dockState, setDockState] = useState<DockUpdateDetail>({
    canSearch: false, layoutLabel: "Switch to Scrolling", hasUnsavedChanges: false, searchActive: false,
  });

  useViewerEvent(VIEWER_EVENTS.dockUpdate, setDockState);
  useViewerEvent(VIEWER_EVENTS.dockToggle, () => setTouchOpen((open) => !open));

  if (dockState.searchActive) return null;

  return (
    <aside aria-label="Reader controls" className={`reader-dock-shell${touchOpen ? " is-touch-open" : ""}`}>
      <div className="reader-dock">
        {dockItems.map((item) => {
          const label = getDockItemLabel(item.action, item.label, dockState);
          const Icon = item.icon;
          const disabled = item.action === "toggle-search" && !dockState.canSearch
            || item.action === "save-book" && !dockState.hasUnsavedChanges;

          return (
            <Tooltip key={item.action} label={label} side="right">
              <Button
                aria-label={label}
                disabled={disabled}
                onClick={() => {
                  setTouchOpen(false);
                  emitViewerEvent(VIEWER_EVENTS.dockAction, item.action);
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

function getDockItemLabel(action: DockAction, fallback: string, dockState: DockUpdateDetail) {
  if (action === "toggle-layout") return dockState.layoutLabel;
  if (action === "save-book" && dockState.hasUnsavedChanges) return "Save changes";
  return fallback;
}
