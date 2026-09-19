import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { DockAction, DockState, SearchState } from "../model";
import { Button, Tooltip } from "./ui";
import { SearchBar } from "./search-bar";

import { Settings, Search, Save, Info, TableOfContents, Palette, Minus, Plus, Minimize2, Maximize2 } from "lucide-react";

export function ReaderDock({
  onAction,
  onOpenChange,
  open,
  state,
  search,
  onCloseSearch,
  onNextSearch,
  onPreviousSearch,
  onSearch,
}: {
  onAction: (action: DockAction) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  state: DockState;
  search: SearchState;
  onCloseSearch: () => void;
  onNextSearch: () => void;
  onPreviousSearch: () => void;
  onSearch: (query: string, highlightedOnly: boolean) => void;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  useEffect(() => cancelHide, [cancelHide]);
  const run = (action: DockAction) => {
    onOpenChange(false);
    onAction(action);
  };

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
      <div className="reader-dock-toolbar">
        {!state.searchActive ? (
          <div className="reader-dock reader-dock-primary" aria-label="Reader toolbar">
            <DockButton label="Settings" icon={Settings} onClick={() => run("open-settings")} />
            <DockButton label="Themes" icon={Palette} onClick={() => run("open-theme")} />
            <DockButton label="Decrease font size" icon={Minus} onClick={() => onAction("decrease-font")} />
            <DockButton label="Increase font size" icon={Plus} onClick={() => onAction("increase-font")} />
            <DockButton label="Zoom out" icon={Minimize2} onClick={() => onAction("decrease-width")} />
            <DockButton label="Zoom in" icon={Maximize2} onClick={() => onAction("increase-width")} />
            <span className="reader-dock-divider" aria-hidden="true" />
            <DockButton label="Search" icon={Search} disabled={!state.canSearch} onClick={() => onAction("toggle-search")} />
            <DockButton label="Outline" icon={TableOfContents} onClick={() => run("open-toc")} />
            <DockButton label={state.hasUnsavedChanges ? "Save changes" : "Save"} icon={Save} disabled={!state.hasUnsavedChanges} onClick={() => run("save-book")} />
            <DockButton label="Book information" icon={Info} onClick={() => run("open-info")} />
          </div>
        ) : (
          <div className="reader-dock-search">
            <SearchBar onBack={onCloseSearch} onClose={onCloseSearch} onNext={onNextSearch} onPrevious={onPreviousSearch} onSearch={onSearch} state={search} />
          </div>
        )}
      </div>
    </aside>
  );
}

function DockButton({ label, icon: Icon, disabled, onClick }: { label: string; icon: LucideIcon; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip label={label} side="bottom">
      <Button className="reader-dock-icon-button" aria-label={label} disabled={disabled} onClick={onClick}>
        <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
