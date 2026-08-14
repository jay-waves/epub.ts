import { Copy, Highlighter, Languages, MessageSquareText, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { useFloatingPosition } from "./floating-position";
import type { HighlightContextAction } from "../context-menu-store";
import { contextMenuStore } from "../context-menu-store";

const menuItems = [
  { action: "copy", enabledBy: "canCopy", icon: Copy, label: "Copy" },
  { action: "translate", enabledBy: "canCopy", icon: Languages, label: "Translate" },
  { action: "highlight", enabledBy: "canHighlight", icon: Highlighter, label: "Highlight" },
  { action: "annotate", enabledBy: "canCopy", icon: MessageSquareText, label: "Annotate" },
  { action: "delete", destructive: true, enabledBy: "canDelete", icon: Trash2, label: "Delete" },
] as const;

export function HighlightContextMenu() {
  const state = useStore(contextMenuStore);
  const { floatingProps, floatingStyles, refs } = useFloatingPosition({
    gap: 4,
    onDismiss: state.close,
    open: state.open,
    point: { x: state.x, y: state.y },
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
          onSelect={state.select}
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
  onSelect,
}: {
  action: HighlightContextAction;
  destructive?: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: (action: HighlightContextAction) => void;
}) {
  return (
    <button
      className={`reader-context-menu-item${destructive ? " is-destructive" : ""}`}
      data-action={action}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={() => onSelect(action)}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
}
