import { Copy, Highlighter, Languages, MessageSquareText, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { usePointPopover } from "./use-point-popover";
import type { ContentContextAction } from "../../context-menu/context-menu-store";
import { contextMenuStore } from "../../context-menu/context-menu-store";

const menuItems = [
  { action: "copy", enabledBy: "canCopy", icon: Copy, label: "Copy" },
  { action: "translate", enabledBy: "canCopy", icon: Languages, label: "Translate" },
  { action: "highlight", enabledBy: "canHighlight", icon: Highlighter, label: "Highlight" },
  { action: "annotate", enabledBy: "canCopy", icon: MessageSquareText, label: "Annotate" },
  { action: "delete", destructive: true, enabledBy: "canDelete", icon: Trash2, label: "Delete" },
] as const;

export function ContentContextMenu() {
  const state = useStore(contextMenuStore);
  const popover = usePointPopover({
    gap: 4,
    onDismiss: state.close,
    open: state.open,
    x: state.x,
    y: state.y,
  });

  if (!state.open) return null;
  const visibleItems = state.kind === "media" ? menuItems.slice(0, 1) : menuItems;

  return (
    <div
        className="reader-context-menu"
        popover="auto"
        ref={popover.setPopover}
        style={popover.popoverStyle}
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
  action: ContentContextAction;
  destructive?: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: (action: ContentContextAction) => void;
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
