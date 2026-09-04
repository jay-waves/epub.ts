import { BookOpen, Copy, Highlighter, Languages, SquarePen, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { usePointPopover } from "./use-point-popover";
import type { ContentContextAction } from "../../context-menu/context-menu-store";
import { contextMenuStore } from "../../context-menu/context-menu-store";

const menuItems = [
  { action: "copy", enabledBy: "canCopy", icon: Copy, label: "Copy" },
  { action: "translate", enabledBy: "canTranslate", icon: Languages, label: "Translate" },
  { action: "lookup", enabledBy: "canLookUp", icon: BookOpen, label: "Look Up" },
  { action: "highlight", enabledBy: "canHighlight", icon: Highlighter, label: "Highlight" },
  { action: "annotate", enabledBy: "canAnnotate", icon: SquarePen, label: "Annotate" },
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
  const visibleItems = menuItems.filter((item) => state[item.enabledBy]);

  return (
    <div
      className="reader-context-menu"
      popover="auto"
      ref={popover.setPopover}
      role="menu"
      style={popover.popoverStyle}
    >
      {visibleItems.map((item) => (
        <ContextMenuItem
          {...item}
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
  icon: Icon,
  label,
  onSelect,
}: {
  action: ContentContextAction;
  destructive?: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: (action: ContentContextAction) => void;
}) {
  return (
    <button
      className={`reader-context-menu-item${destructive ? " is-destructive" : ""}`}
      data-action={action}
      role="menuitem"
      type="button"
      onClick={() => onSelect(action)}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
}
