import { useCallback, useEffect, useRef, useState } from "react";
import * as Toolbar from "@radix-ui/react-toolbar";
import { focusReaderAfterAction } from "../reader-focus";
import type { LucideIcon } from "lucide-react";
import type { DockAction, DockState, SearchState } from "../model";
import { Tooltip } from "./ui";
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
  onAction: (action: DockAction) => Promise<void>;
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
  const activate = (action: DockAction, returnFocus: boolean) => {
    const source = document.activeElement;
    void onAction(action).then(() => {
      if (returnFocus) focusReaderAfterAction(source);
    });
  };
  const run = (action: DockAction, returnFocus = false) => {
    onOpenChange(false);
    activate(action, returnFocus);
  };
  const closeSearch = () => {
    const source = document.activeElement;
    onCloseSearch();
    focusReaderAfterAction(source);
  };

  return (
    <aside
      aria-label="Reader controls"
      className={`reader-dock-shell${open ? " is-touch-open" : ""}${hoverOpen ? " is-hover-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (state.searchActive) {
          closeSearch();
          return;
        }
        onOpenChange(false);
        setHoverOpen(false);
        focusReaderAfterAction();
      }}
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
          <Toolbar.Root className="reader-dock reader-dock-primary" aria-label="Reader toolbar">
            <DockButton label="Settings" icon={Settings} onClick={() => run("open-settings")} />
            <DockButton label="Themes" icon={Palette} onClick={() => run("open-theme")} />
            <DockButton label="Decrease font size" icon={Minus} onClick={(pointer) => activate("decrease-font", pointer)} />
            <DockButton label="Increase font size" icon={Plus} onClick={(pointer) => activate("increase-font", pointer)} />
            <DockButton label="Zoom out" icon={Minimize2} onClick={(pointer) => activate("decrease-width", pointer)} />
            <DockButton label="Zoom in" icon={Maximize2} onClick={(pointer) => activate("increase-width", pointer)} />
            <Toolbar.Separator className="reader-dock-divider" />
            <DockButton label="Search" icon={Search} disabled={!state.canSearch} onClick={() => onAction("toggle-search")} />
            <DockButton label="Outline" icon={TableOfContents} onClick={() => run("open-toc")} />
            <DockButton label={state.hasUnsavedChanges ? "Save changes" : "Save"} icon={Save} disabled={!state.hasUnsavedChanges} onClick={(pointer) => run("save-book", pointer)} />
            <DockButton label="Book information" icon={Info} onClick={() => run("open-info")} />
          </Toolbar.Root>
        ) : (
          <div className="reader-dock-search">
            <SearchBar onBack={closeSearch} onClose={closeSearch} onNext={onNextSearch} onPrevious={onPreviousSearch} onSearch={onSearch} state={search} />
          </div>
        )}
      </div>
    </aside>
  );
}

function DockButton({ label, icon: Icon, disabled, onClick }: { label: string; icon: LucideIcon; disabled?: boolean; onClick: (pointer: boolean) => void }) {
  return (
    <Tooltip label={label} side="bottom">
      <Toolbar.Button className="ui-button reader-dock-icon-button" aria-label={label} disabled={disabled} onClick={(event) => onClick(event.detail > 0)}>
        <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
      </Toolbar.Button>
    </Tooltip>
  );
}
