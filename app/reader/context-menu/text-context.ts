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
  getTranslationSourceLanguage: () => string | undefined;
  getTranslationTargetLanguage: () => string;
  onAction: (detail: TextContextActionDetail<Context>) => void;
  onClose: () => void;
  openExternal: (url: string) => void;
  updateUi: (state: Partial<ReaderUiState>) => void;
};

function getLookupTerm(text: string) {
  const term = text.trim();
  return term.length <= 100
    && /^[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*$/u.test(term)
    ? term
    : null;
}

function wiktionaryUrl(term: string) {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`;
}

/** Generic text actions over plain text and viewport coordinates. */
export function createTextContext<Context>(options: TextContextOptions<Context>) {
  const translation = createTranslation({
    getSourceLanguage: options.getTranslationSourceLanguage,
    getTargetLanguage: options.getTranslationTargetLanguage,
    onUpdate: (detail) => options.updateUi({ translation: detail }),
  });
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
      case "copy":
        run(navigator.clipboard.writeText(request.text), "Failed to copy reader text.");
        break;
      case "lookup": {
        const term = getLookupTerm(request.text);
        if (term) options.openExternal(wiktionaryUrl(term));
        break;
      }
      case "translate":
        void translation.translate({ sourceText: request.text, ...request.point });
        break;
    }
    options.onAction({ action, context: request.context, point: request.point, text: request.text });
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
      options.closeAnnotation();
      options.updateUi({ translation: null });
    },
    open(request: TextContextRequest<Context>) {
      current = request;
      const canLookUp = request.canHighlight && Boolean(getLookupTerm(request.text));
      options.updateUi({ contextMenu: {
        menu: {
          canAnnotate: true,
          canCopy: true,
          canDelete: request.canDelete,
          canHighlight: request.canHighlight,
          canLookUp,
          canTranslate: true,
          ...request.point,
        },
        onAction: handleAction,
        onClose: clear,
      } });
    },
    closeTranslation() {
      translation.cancel();
      options.updateUi({ translation: null });
    },
    downloadTranslation: translation.download,
    setTranslationSourceLanguage: translation.setSourceLanguage,
  };
}
