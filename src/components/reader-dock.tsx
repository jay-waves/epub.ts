import { useEffect, useState } from "react";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { DockAction, DockUpdateDetail } from "../viewer-events";
import { Button, Tooltip } from "./ui";

import { BookOpen, Palette, Minus, Plus, Minimize2, Maximize2, Save, Scroll, Search, Info, TableOfContents } from "lucide-react";

const dockItems = [
  {
    action: "toggle-flow",
    id: "toggle-flow-button",
    label: "Switch to scrolling mode",
    icon: BookOpen,
  },
  {
    action: "toggle-theme",
    id: "toggle-theme-button",
    label: "Change theme",
    icon: Palette,
  },
  { action: "decrease-font", id: "decrease-font-button", label: "Decrease font size", icon: Minus },
  { action: "increase-font", id: "increase-font-button", label: "Increase font size", icon: Plus },
  { action: "increase-width", id: "increase-width-button", label: "Zoom in", icon: Maximize2 },
  { action: "decrease-width", id: "decrease-width-button", label: "Zoom out", icon: Minimize2 },
  { action: "toggle-search", id: "open-search-button", label: "Search", icon: Search },
  { action: "open-toc", id: "open-toc-button", label: "Table of contents", icon: TableOfContents },
  { action: "save-book", id: "save-book-button", label: "Save", icon: Save },
  { action: "open-info", id: "open-info-button", label: "Book information", icon: Info },
] as const;

export function ReaderDock() {
  const [dockState, setDockState] = useState<DockUpdateDetail>({
    canSearch: false, flowActive: false, flowLabel: "Switch to scrolling mode", hasUnsavedChanges: false, searchActive: false,
  });

  useEffect(() => {
    return listenViewerEvent(VIEWER_EVENTS.dockUpdate, setDockState);
  }, []);

  if (dockState.searchActive) return null;

  return (
    <aside className="reader-dock-shell">
      <div className="reader-dock">
        {dockItems.map((item) => {
          const label = getDockItemLabel(item.action, item.label, dockState);
          const disabled = isDockItemDisabled(item.action, dockState);
          const Icon = getDockItemIcon(item.action, item.icon, dockState);

          return (
            <Tooltip key={item.id} label={label} side="right">
              <Button
                id={item.id}
                aria-label={label}
                disabled={disabled}
                onClick={() => emitViewerEvent(VIEWER_EVENTS.dockAction, item.action)}
              >
                <span className="dock-button-content">
                  <Icon size={20} aria-hidden="true" />
                  {item.action === "save-book" && dockState.hasUnsavedChanges ? (
                    <span className="dock-unsaved-dot" aria-hidden="true" />
                  ) : null}
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
  if (action === "toggle-flow") return dockState.flowLabel;
  if (action === "save-book" && dockState.hasUnsavedChanges) return "Save changes";
  return fallback;
}

function getDockItemIcon(action: DockAction, fallback: typeof BookOpen, dockState: DockUpdateDetail) {
  if (action === "toggle-flow") return dockState.flowActive ? BookOpen : Scroll;
  return fallback;
}

function isDockItemDisabled(action: DockAction, dockState: DockUpdateDetail) {
  if (action === "toggle-search") return !dockState.canSearch;
  return false;
}
