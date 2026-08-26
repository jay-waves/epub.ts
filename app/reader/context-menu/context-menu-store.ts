import { createStore } from "zustand/vanilla";


export type ContentContextAction =
  | "annotate"
  | "copy"
  | "delete"
  | "highlight"
  | "lookup"
  | "translate";

export type ContentContextMenu = {
  canAnnotate: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canHighlight: boolean;
  canLookUp: boolean;
  canTranslate: boolean;
  kind: "media" | "text";
  x: number;
  y: number;
};

type ContextMenuState = ContentContextMenu & {
  close: () => void;
  open: boolean;
  openMenu: (
    menu: ContentContextMenu,
    onAction: (action: ContentContextAction) => void,
    onClose: () => void,
  ) => void;
  select: (action: ContentContextAction) => void;
};

const closedMenu: ContentContextMenu = {
  canAnnotate: false,
  canCopy: false,
  canDelete: false,
  canHighlight: false,
  canLookUp: false,
  canTranslate: false,
  kind: "text",
  x: 0,
  y: 0,
};

let actionHandler: ((action: ContentContextAction) => void) | undefined;
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
