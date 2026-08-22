import type { HighlightContextAction } from "./context-menu-store";
import { contextMenuStore } from "./context-menu-store";
import { emitViewerEvent, VIEWER_EVENTS } from "./events";
import { createTranslation } from "./translation";

type TextContextRequest = {
  canDelete: boolean;
  canHighlight: boolean;
  onAnnotate: () => void;
  onDelete?: () => void;
  onHighlight?: () => void;
  point: { x: number; y: number };
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
  let current: TextContextRequest | null = null;

  const close = () => {
    current = null;
    contextMenuStore.getState().close();
  };
  const run = (task: Promise<unknown>, message: string) => {
    void task.catch((error) => console.warn(message, error));
  };
  const handleAction = (action: HighlightContextAction) => {
    const request = current;
    if (!request) return;
    switch (action) {
      case "copy":
        run(navigator.clipboard.writeText(request.text), "Failed to copy reader text.");
        break;
      case "translate":
        void translation.translate({ sourceText: request.text, ...request.point });
        break;
      case "annotate":
        request.onAnnotate();
        break;
      case "delete":
        request.onDelete?.();
        break;
      case "highlight":
        request.onHighlight?.();
    }
  };

  return {
    close,
    destroy() {
      close();
      translation.destroy();
    },
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
      }, handleAction, () => { current = null; });
    },
  };
}
