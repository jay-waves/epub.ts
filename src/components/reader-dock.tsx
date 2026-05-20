import { useEffect, useState } from "react";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { DockAction, DockUpdateDetail } from "../viewer-events";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

import { BookOpen, Palette, Minus, Plus, Minimize2, Maximize2, Search, ListTree, Download } from "lucide-react";

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
    countId: "theme-count",
  },
  { action: "decrease-font", id: "decrease-font-button", label: "Decrease font size", icon: Minus },
  { action: "increase-font", id: "increase-font-button", label: "Increase font size", icon: Plus },
  { action: "decrease-width", id: "decrease-width-button", label: "Tighter layout", icon: Minimize2 },
  { action: "increase-width", id: "increase-width-button", label: "Looser layout", icon: Maximize2 },
  { action: "toggle-search", id: "open-search-button", label: "Search", icon: Search },
  { action: "open-toc", id: "open-toc-button", label: "Table of contents", icon: ListTree },
  { action: "export", id: "export-button", label: "Export original EPUB", icon: Download },
] as const;

export function ReaderDock() {
  const [dockState, setDockState] = useState<DockUpdateDetail>({
    canExport: false, canSearch: false, flowActive: false, flowLabel: "Switch to scrolling mode", searchActive: false, themeActive: false, themeCount: "1",
  });

  useEffect(() => {
    return listenViewerEvent(VIEWER_EVENTS.dockUpdate, setDockState);
  }, []);

  return (
    <aside className="reader-dock-shell">
      <div className="reader-dock">
        {dockItems.map((item) => {
          const label = getDockItemLabel(item.action, item.label, dockState);
          const disabled = isDockItemDisabled(item.action, dockState);
          const active = isDockItemActive(item.action, dockState);
          const Icon = item.icon;

          return (
            <Tooltip key={item.id} label={label} side="right">
              <Button
                id={item.id}
                aria-disabled={disabled ? "true" : undefined}
                aria-label={label}
                className={active ? "dock-active" : undefined}
                disabled={disabled}
                variant="ghost"
                size="icon"
                onClick={() => emitViewerEvent(VIEWER_EVENTS.dockAction, item.action)}
              >
                <span className="dock-button-content">
                  <Icon size={20} aria-hidden="true" />
                  {"countId" in item ? (
                    <span id={item.countId} className="dock-button-count">
                      {dockState.themeCount}
                    </span>
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
  return fallback;
}

function isDockItemDisabled(action: DockAction, dockState: DockUpdateDetail) {
  if (action === "toggle-search") return !dockState.canSearch;
  if (action === "export") return !dockState.canExport;
  return false;
}

function isDockItemActive(action: DockAction, dockState: DockUpdateDetail) {
  if (action === "toggle-flow") return dockState.flowActive;
  if (action === "toggle-search") return dockState.searchActive;
  if (action === "toggle-theme") return dockState.themeActive;
  return false;
}
