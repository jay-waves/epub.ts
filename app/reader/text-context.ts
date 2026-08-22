import type { ContentContextAction } from "./context-menu-store";
import { contextMenuStore } from "./context-menu-store";
import { emitViewerEvent, VIEWER_EVENTS } from "./events";
import { createTranslation } from "./translation";

type TextContextRequest = {
  canDelete: boolean;
  canHighlight: boolean;
  point: { x: number; y: number };
  text: string;
};

export type TextContextActionDetail = {
  action: ContentContextAction;
  point: TextContextRequest["point"];
  text: string;
};

type TextContextOptions = {
  openExternal: (url: string) => void;
  translationModelPolicy: "allow-download" | "external-fallback";
};

/** Generic text actions over plain text and viewport coordinates. */
export function createTextContext(options: TextContextOptions) {
  const translation = createTranslation({
    modelPolicy: options.translationModelPolicy,
    openExternal: options.openExternal,
  });
  const events = new EventTarget();
  let current: TextContextRequest | null = null;

  const clear = () => {
    if (!current) return;
    current = null;
    events.dispatchEvent(new Event("close"));
  };
  const close = () => {
    contextMenuStore.getState().close();
    clear();
  };
  const run = (task: Promise<unknown>, message: string) => {
    void task.catch((error) => console.warn(message, error));
  };
  const handleAction = (action: ContentContextAction) => {
    const request = current;
    if (!request) return;
    switch (action) {
      case "copy":
        run(navigator.clipboard.writeText(request.text), "Failed to copy reader text.");
        break;
      case "translate":
        void translation.translate({ sourceText: request.text, ...request.point });
        break;
    }
    events.dispatchEvent(new CustomEvent<TextContextActionDetail>("action", {
      detail: { action, point: request.point, text: request.text },
    }));
  };

  return {
    close,
    destroy() {
      close();
      translation.destroy();
    },
    events,
    dismiss() {
      close();
      translation.cancel();
      emitViewerEvent(VIEWER_EVENTS.translationClose);
      emitViewerEvent(VIEWER_EVENTS.annotationClose);
    },
    open(request: TextContextRequest) {
      current = request;
      contextMenuStore.getState().openMenu({
        canCopy: true,
        canDelete: request.canDelete,
        canHighlight: request.canHighlight,
        kind: "text",
        ...request.point,
      }, handleAction, clear);
    },
  };
}
