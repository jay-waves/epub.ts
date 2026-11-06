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
  getTranslationTargetLanguage: () => string;
  getTranslationEnabled: () => boolean;
  getLlmEnabled: () => boolean;
  requestAi?: import("../../platform/types").ViewerPlatform["requestAi"];
  openExternal: (url: string) => void;
  onAction: (detail: TextContextActionDetail<Context>) => void;
  onClose: () => void;
  updateUi: (state: Partial<ReaderUiState>) => void;
};

function getLookupTerm(text: string) {
  const term = text.trim();
  return term.length <= 100
    && /^[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*$/u.test(term)
    ? term
    : null;
}

/** Generic text actions over plain text and viewport coordinates. */
export function createTextContext<Context>(options: TextContextOptions<Context>) {
  const browserTranslation = createTranslation({
    getSourceLanguage: () => undefined,
    getTargetLanguage: options.getTranslationTargetLanguage,
    onUpdate: (detail) => options.updateUi({ translation: detail }),
  });
  const cancelTranslation = () => browserTranslation.cancel();
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
        void browserTranslation.translate({ sourceText: request.text, ...request.point });
        break;
    }
    options.onAction({ action, context: request.context, point: request.point, text: request.text });
  };
  const lookup = ({ sourceText, x, y }: Pick<import("../ui/model").TranslationDetail, "sourceText" | "x" | "y">) => {
    const term = getLookupTerm(sourceText);
    if (!term) return;
    cancelTranslation();
    void browserTranslation.translate({ sourceText: term, x, y });
  };

  return {
    close,
    destroy() {
      close();
      cancelTranslation();
      browserTranslation.destroy();
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
    downloadTranslation: browserTranslation.download,
    lookup,
    setTranslationSourceLanguage: browserTranslation.setSourceLanguage,
  };
}
