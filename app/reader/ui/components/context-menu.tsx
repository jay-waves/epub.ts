import { BookOpen, Copy, Highlighter, Languages, SquarePen, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePointPopover } from "./use-point-popover";
import type { ContentContextAction, ContentContextMenuDetail } from "../model";

const menuItems = [
  { action: "copy", enabledBy: "canCopy", icon: Copy, label: "Copy" },
  { action: "translate", enabledBy: "canTranslate", icon: Languages, label: "Translate" },
  { action: "lookup", enabledBy: "canLookUp", icon: BookOpen, label: "Look Up" },
  { action: "highlight", enabledBy: "canHighlight", icon: Highlighter, label: "Highlight" },
  { action: "annotate", enabledBy: "canAnnotate", icon: SquarePen, label: "Annotate" },
  { action: "delete", destructive: true, enabledBy: "canDelete", icon: Trash2, label: "Delete" },
] as const;

export function ContentContextMenu({ onClose, state }: {
  onClose: () => void;
  state: ContentContextMenuDetail | null;
}) {
  const menu = state?.menu;
  const popover = usePointPopover({
    gap: 4,
    onDismiss: onClose,
    open: Boolean(menu),
    x: menu?.x ?? 0,
    y: menu?.y ?? 0,
  });

  if (!menu) return null;
  const visibleItems = menuItems.filter((item) => menu[item.enabledBy]);

  return (
    <div
      className="reader-context-menu"
      popover="manual"
      ref={popover.setPopover}
      role="menu"
      style={popover.popoverStyle}
    >
      {visibleItems.map((item) => (
        <ContextMenuItem
          {...item}
          key={item.action}
          onSelect={(action) => {
            state.onAction(action);
            onClose();
          }}
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
