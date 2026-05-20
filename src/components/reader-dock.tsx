import { useEffect, useState } from "react";
import { VIEWER_EVENTS } from "../viewer-events";
import type { DockAction, DockActionDetail, DockUpdateDetail } from "../viewer-events";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

const dockItems = [
  {
    action: "toggle-flow",
    id: "toggle-flow-button",
    label: "Switch to scrolling mode",
    icon: "book-open",
  },
  {
    action: "toggle-theme",
    id: "toggle-theme-button",
    label: "Change theme",
    icon: "palette",
    countId: "theme-count",
  },
  { action: "decrease-font", id: "decrease-font-button", label: "Decrease font size", icon: "minus" },
  { action: "increase-font", id: "increase-font-button", label: "Increase font size", icon: "plus" },
  { action: "decrease-width", id: "decrease-width-button", label: "Narrower layout", icon: "minimize-2" },
  { action: "increase-width", id: "increase-width-button", label: "Wider layout", icon: "maximize-2" },
  { action: "toggle-search", id: "open-search-button", label: "Search", icon: "search" },
  { action: "open-toc", id: "open-toc-button", label: "Table of contents", icon: "list-tree" },
  { action: "export", id: "export-button", label: "Export original EPUB", icon: "download" },
] as const;

const initialDockState: DockUpdateDetail = {
  canExport: false,
  canSearch: false,
  flowActive: false,
  flowLabel: "Switch to scrolling mode",
  searchActive: false,
  themeActive: false,
  themeCount: "1",
  themeLabel: "Change theme",
};

export function ReaderDock() {
  const [dockState, setDockState] = useState(initialDockState);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      setDockState((event as CustomEvent<DockUpdateDetail>).detail);
    };

    window.addEventListener(VIEWER_EVENTS.dockUpdate, handleUpdate);
    return () => window.removeEventListener(VIEWER_EVENTS.dockUpdate, handleUpdate);
  }, []);

  const runAction = (action: DockAction) => {
    window.dispatchEvent(
      new CustomEvent<DockActionDetail>(VIEWER_EVENTS.dockAction, {
        detail: { action },
      }),
    );
  };

  return (
    <aside className="reader-dock-shell">
      <div className="reader-dock">
        {dockItems.map((item) => {
          const label = getDockItemLabel(item.action, item.label, dockState);
          const disabled = isDockItemDisabled(item.action, dockState);
          const active = isDockItemActive(item.action, dockState);

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
                onClick={() => runAction(item.action)}
              >
                <span className="dock-button-content">
                  <i
                    data-lucide={item.icon}
                  />
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
  if (action === "toggle-theme") return dockState.themeLabel;
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
