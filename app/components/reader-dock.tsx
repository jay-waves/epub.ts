import { useState } from "react";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { DockAction, DockUpdateDetail } from "../viewer-events";
import { Button, Tooltip } from "./ui";
import { useViewerEvent } from "./use-viewer-event";
import type { LucideIcon } from "lucide-react";

import { BookOpen, Palette, Minus, Plus, Minimize2, Maximize2, Save, Scroll, Search, Info, TableOfContents } from "lucide-react";

const dockItems = [
  {
    action: "toggle-flow",
    label: "Switch to scrolling mode",
    icon: BookOpen,
  },
  {
    action: "toggle-theme",
    label: "Change theme",
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
  const [dockState, setDockState] = useState<DockUpdateDetail>({
    canSearch: false, flowActive: false, flowLabel: "Switch to scrolling mode", hasUnsavedChanges: false, searchActive: false,
  });

  useViewerEvent(VIEWER_EVENTS.dockUpdate, setDockState);

  if (dockState.searchActive) return null;

  return (
    <aside className="reader-dock-shell">
      <div className="reader-dock">
        {dockItems.map((item) => {
          const label = getDockItemLabel(item.action, item.label, dockState);
          const Icon = getDockItemIcon(item.action, item.icon, dockState);
          const disabled = item.action === "toggle-search" && !dockState.canSearch
            || item.action === "save-book" && !dockState.hasUnsavedChanges;

          return (
            <Tooltip key={item.action} label={label} side="right">
              <Button
                aria-label={label}
                disabled={disabled}
                onClick={() => emitViewerEvent(VIEWER_EVENTS.dockAction, item.action)}
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
  if (action === "toggle-flow") return dockState.flowLabel;
  if (action === "save-book" && dockState.hasUnsavedChanges) return "Save changes";
  return fallback;
}

function getDockItemIcon(action: DockAction, fallback: LucideIcon, dockState: DockUpdateDetail) {
  if (action === "toggle-flow") return dockState.flowActive ? BookOpen : Scroll;
  return fallback;
}
