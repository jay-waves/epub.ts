import { useEffect, useState } from "react";
import { LucideIcon, Copy, Highlighter, Languages, Trash2 } from "lucide-react"
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type {
  HighlightContextAction,
  HighlightContextOpenDetail,
} from "../viewer-events";

type MenuState = HighlightContextOpenDetail & {
  open: boolean;
};

const closedState: MenuState = {
  canCopy: false,
  canDelete: false,
  canHighlight: false,
  open: false,
  x: 0,
  y: 0,
};

const menuItems = [
  { action: "copy", enabledBy: "canCopy", icon: Copy, label: "Copy" },
  { action: "translate", enabledBy: "canCopy", icon: Languages, label: "Translate" },
  { action: "highlight", enabledBy: "canHighlight", icon: Highlighter, label: "Highlight" },
  { action: "delete", destructive: true, enabledBy: "canDelete", icon: Trash2, label: "Delete" },
] as const;

export function HighlightContextMenu() {
  const [state, setState] = useState<MenuState>(closedState);

  useEffect(() => {
    const open = (detail: HighlightContextOpenDetail) => {
      setState({ ...detail, open: true });
    };
    const close = () => setState((current) => ({ ...current, open: false }));
    const requestClose = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-context-menu")) return;
      close();
      emitViewerEvent(VIEWER_EVENTS.highlightContextClose);
    };

    const stopOpen = listenViewerEvent(VIEWER_EVENTS.highlightContextOpen, open);
    const stopClose = listenViewerEvent(VIEWER_EVENTS.highlightContextClose, close);
    window.addEventListener("pointerdown", requestClose);
    window.addEventListener("contextmenu", requestClose);
    window.addEventListener("keydown", requestClose);
    return () => {
      stopOpen();
      stopClose();
      window.removeEventListener("pointerdown", requestClose);
      window.removeEventListener("contextmenu", requestClose);
      window.removeEventListener("keydown", requestClose);
    };
  }, []);

  if (!state.open) return null;

  return (
    <div
      className="reader-context-menu"
      style={{
        left: state.x,
        top: state.y,
      }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menuItems.map((item) => (
        <ContextMenuItem
          {...item}
          disabled={!state[item.enabledBy]}
          key={item.action}
          onClose={closeMenu}
        />
      ))}
    </div>
  );

  function closeMenu() {
    setState((current) => ({ ...current, open: false }));
  }
}

function ContextMenuItem({
  action,
  destructive = false,
  disabled,
  icon: Icon,
  label,
  onClose,
}: {
  action: HighlightContextAction;
  destructive?: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClose: () => void;
}) {
  return (
    <button
      className={`reader-context-menu-item${destructive ? " is-destructive" : ""}`}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={() => {
        emitViewerEvent(VIEWER_EVENTS.highlightContextAction, action);
        onClose();
        emitViewerEvent(VIEWER_EVENTS.highlightContextClose);
      }}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
}
