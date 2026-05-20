import { useEffect, useState } from "react";
import { LucideIcon, Copy, Highlighter, Languages, Trash2 } from "lucide-react"
import { VIEWER_EVENTS } from "../viewer-events";
import type {
  HighlightContextAction,
  HighlightContextActionDetail,
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

export function HighlightContextMenu() {
  const [state, setState] = useState<MenuState>(closedState);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<HighlightContextOpenDetail>).detail;
      setState({ ...detail, open: true });
    };
    const close = () => setState((current) => ({ ...current, open: false }));
    const requestClose = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-context-menu")) return;
      close();
      window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.highlightContextClose));
    };

    window.addEventListener(VIEWER_EVENTS.highlightContextOpen, open);
    window.addEventListener(VIEWER_EVENTS.highlightContextClose, close);
    window.addEventListener("pointerdown", requestClose);
    window.addEventListener("contextmenu", requestClose);
    window.addEventListener("keydown", requestClose);
    return () => {
      window.removeEventListener(VIEWER_EVENTS.highlightContextOpen, open);
      window.removeEventListener(VIEWER_EVENTS.highlightContextClose, close);
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
      <ContextMenuItem action="copy" disabled={!state.canCopy} icon={Copy} onClose={closeMenu}>
        Copy
      </ContextMenuItem>
      <ContextMenuItem action="translate" disabled={!state.canCopy} icon={Languages} onClose={closeMenu}>
        Translate
      </ContextMenuItem>
      <ContextMenuItem action="highlight" disabled={!state.canHighlight} icon={Highlighter} onClose={closeMenu}>
        Highlight
      </ContextMenuItem>
      <ContextMenuItem action="delete" disabled={!state.canDelete} destructive icon={Trash2} onClose={closeMenu}>
        Delete
      </ContextMenuItem>
    </div>
  );

  function closeMenu() {
    setState((current) => ({ ...current, open: false }));
  }
}

function ContextMenuItem({
  action,
  children,
  destructive = false,
  disabled,
  icon: Icon,
  onClose,
}: {
  action: HighlightContextAction;
  children: string;
  destructive?: boolean;
  disabled: boolean;
  icon: LucideIcon;
  onClose: () => void;
}) {
  return (
    <button
      className={`reader-context-menu-item${destructive ? " is-destructive" : ""}`}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent<HighlightContextActionDetail>(VIEWER_EVENTS.highlightContextAction, {
            detail: { action },
          }),
        );
        onClose();
        window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.highlightContextClose));
      }}
    >
      <Icon size={20} aria-hidden="true" />
      {children}
    </button>
  );
}
