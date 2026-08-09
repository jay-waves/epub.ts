import { useState } from "react";
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
  kind: "text",
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
  const close = () => emitViewerEvent(VIEWER_EVENTS.highlightContextClose);
  const { floatingProps, floatingStyles, refs } = useFloatingPosition({
    gap: 4,
    onDismiss: close,
    open: state.open,
    point: { x: state.x, y: state.y },
  });

  useViewerEvent(VIEWER_EVENTS.highlightContextOpen, (detail) => {
    setState({ ...detail, open: true });
  });
  useViewerEvent(VIEWER_EVENTS.highlightContextClose, () => {
    setState((current) => ({ ...current, open: false }));
  });

  if (!state.open) return null;
  const visibleItems = state.kind === "media" ? menuItems.slice(0, 1) : menuItems;

  return (
    <div
      {...floatingProps}
      className="reader-context-menu"
      ref={refs.setFloating}
      style={floatingStyles}
      role="menu"
    >
      {visibleItems.map((item) => (
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
