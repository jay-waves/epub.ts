import { useEffect, useRef, useState } from "react";
import { Copy, Highlighter, Languages, MessageSquareText, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useFloatingPosition } from "./floating-position";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type {
  HighlightContextAction,
  HighlightContextOpenDetail,
} from "../viewer-events";
import { useViewerEvent } from "./use-viewer-event";

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
  { action: "annotate", enabledBy: "canCopy", icon: MessageSquareText, label: "Annotate" },
  { action: "delete", destructive: true, enabledBy: "canDelete", icon: Trash2, label: "Delete" },
] as const;

export function HighlightContextMenu() {
  const [state, setState] = useState<MenuState>(closedState);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = useFloatingPosition(
    menuRef,
    { x: state.x, y: state.y },
    state.open,
    { fallbackHeight: 150, fallbackWidth: 144, gap: 4 },
  );
  const close = () => setState((current) => ({ ...current, open: false }));

  useViewerEvent(VIEWER_EVENTS.highlightContextOpen, (detail) => {
    setState({ ...detail, open: true });
  });
  useViewerEvent(VIEWER_EVENTS.highlightContextClose, close);

  useEffect(() => {
    const requestClose = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-context-menu")) return;
      emitViewerEvent(VIEWER_EVENTS.highlightContextClose);
    };

    window.addEventListener("pointerdown", requestClose);
    window.addEventListener("contextmenu", requestClose);
    window.addEventListener("keydown", requestClose);
    return () => {
      window.removeEventListener("pointerdown", requestClose);
      window.removeEventListener("contextmenu", requestClose);
      window.removeEventListener("keydown", requestClose);
    };
  }, []);

  if (!state.open) return null;

  return (
    <div
      className="reader-context-menu"
      ref={menuRef}
      style={position}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menuItems.map((item) => (
        <ContextMenuItem
          {...item}
          disabled={!state[item.enabledBy]}
          key={item.action}
        />
      ))}
    </div>
  );
}

function ContextMenuItem({
  action,
  destructive = false,
  disabled,
  icon: Icon,
  label,
}: {
  action: HighlightContextAction;
  destructive?: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      className={`reader-context-menu-item${destructive ? " is-destructive" : ""}`}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={() => {
        emitViewerEvent(VIEWER_EVENTS.highlightContextAction, action);
        emitViewerEvent(VIEWER_EVENTS.highlightContextClose);
      }}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
}
