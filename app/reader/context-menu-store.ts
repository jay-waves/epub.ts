import { createStore } from "zustand/vanilla";

export type HighlightContextAction = "annotate" | "copy" | "delete" | "highlight" | "translate";

export type HighlightContextMenu = {
  canCopy: boolean;
  canDelete: boolean;
  canHighlight: boolean;
  kind: "media" | "text";
  x: number;
  y: number;
};

type ContextMenuState = HighlightContextMenu & {
  close: () => void;
  open: boolean;
  openMenu: (
    menu: HighlightContextMenu,
    onAction: (action: HighlightContextAction) => void,
    onClose: () => void,
  ) => void;
  select: (action: HighlightContextAction) => void;
};

const closedMenu: HighlightContextMenu = {
  canCopy: false,
  canDelete: false,
  canHighlight: false,
  kind: "text",
  x: 0,
  y: 0,
};

let actionHandler: ((action: HighlightContextAction) => void) | undefined;
let closeHandler: (() => void) | undefined;

export const contextMenuStore = createStore<ContextMenuState>((set, get) => ({
  ...closedMenu,
  close: () => {
    const state = get();
    if (!state.open) return;
    const handleClose = closeHandler;
    actionHandler = undefined;
    closeHandler = undefined;
    set({ ...closedMenu, open: false });
    handleClose?.();
  },
  open: false,
  openMenu: (menu, onAction, onClose) => {
    actionHandler = onAction;
    closeHandler = onClose;
    set({ ...menu, open: true });
  },
  select: (action) => {
    actionHandler?.(action);
    get().close();
  },
}));
