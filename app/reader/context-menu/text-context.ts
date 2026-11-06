import { googleTranslationUrl } from "./translation-url";
import { createTranslation } from "./translation";
import type { ContentContextAction, ReaderUiState } from "../ui/model";

type TextContextRequest<Context> = {
  canDelete: boolean;
  canHighlight: boolean;
  context?: Context;
  point: { x: number; y: number };
  text: string;
};

export type TextContextActionDetail<Context> = {
  action: ContentContextAction;
  context?: Context;
  point: TextContextRequest<Context>["point"];
  text: string;
};

type TextContextOptions<Context> = {
  closeAnnotation: () => void;
  getTranslationEnabled: () => boolean;
  getLlmEnabled: () => boolean;
  requestAi?: import("../../platform/types").ViewerPlatform["requestAi"];
  openExternal: (url: string) => void;
  onAction: (detail: TextContextActionDetail<Context>) => void;
  onClose: () => void;
  updateUi: (state: Partial<ReaderUiState>) => void;
};

/** Generic text actions over plain text and viewport coordinates. */
export function createTextContext<Context>(options: TextContextOptions<Context>) {
  const remoteTranslation = createTranslation({
    requestAi: options.requestAi,
    onUpdate: (detail) => options.updateUi({ translation: detail }),
  });
  const cancelTranslation = () => remoteTranslation.cancel();
  let current: TextContextRequest<Context> | null = null;

  const clear = () => {
    if (!current) return;
    current = null;
    options.onClose();
  };
  const close = () => {
    options.updateUi({ contextMenu: null });
    clear();
  };
  const run = (task: Promise<unknown>, message: string) => {
    void task.catch((error) => console.warn(message, error));
  };
  const handleAction = (action: ContentContextAction) => {
    const request = current;
    if (!request) return;
    switch (action) {
      case "llm":
        if (!options.getLlmEnabled() || !options.requestAi) break;
        cancelTranslation();
        options.closeAnnotation();
        options.updateUi({ translation: null, llm: { text: request.text, ...request.point } });
        break;
      case "copy":
        run(navigator.clipboard.writeText(request.text), "Failed to copy reader text.");
        break;
      case "translate":
        if (!options.getTranslationEnabled()) break;
        options.closeAnnotation();
        options.updateUi({ llm: null });
        cancelTranslation();
        if (options.getLlmEnabled()) {
          void remoteTranslation.translate({ sourceText: request.text, ...request.point });
        } else {
          options.updateUi({ translation: null });
          options.openExternal(googleTranslationUrl(request.text));
        }
        break;
    }
    options.onAction({ action, context: request.context, point: request.point, text: request.text });
  };

  return {
    close,
    destroy() {
      close();
      cancelTranslation();
    },
    dismiss() {
      close();
      cancelTranslation();
      options.closeAnnotation();
      options.updateUi({ translation: null, llm: null });
    },
    open(request: TextContextRequest<Context>) {
      current = request;
      options.updateUi({ contextMenu: {
        menu: {
          canAnnotate: true,
          canCopy: true,
          canDelete: request.canDelete,
          canHighlight: request.canHighlight,
          canTranslate: options.getTranslationEnabled(),
          translationExternal: !options.getLlmEnabled(),
          canAskLlm: options.getLlmEnabled() && Boolean(options.requestAi),
          ...request.point,
        },
        onAction: handleAction,
        onClose: clear,
      } });
    },
    closeTranslation() {
      cancelTranslation();
      options.updateUi({ translation: null, llm: null });
    },
  };
}
