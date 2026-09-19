import { createLlmTranslation } from "./llm-translation";
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
  getLlmTranslationPrompt: () => string;
  getLlmLookupPrompt: () => string;
  requestAi?: (request: import("../../platform/types").AiRequest) => Promise<string>;
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
  const translation = options.requestAi
    ? createLlmTranslation({
      getTranslationPrompt: options.getLlmTranslationPrompt,
      getLookupPrompt: options.getLlmLookupPrompt,
      onUpdate: (detail) => options.updateUi({ translation: detail }),
      requestAi: options.requestAi,
    })
    : createTranslation({
      getSourceLanguage: () => undefined,
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
      case "translate":
        if (options.requestAi) {
          void (translation as ReturnType<typeof createLlmTranslation>).request({ text: request.text, ...request.point, lookup: false });
        } else {
          void (translation as ReturnType<typeof createTranslation>).translate({ sourceText: request.text, ...request.point });
        }
        break;
    }
    options.onAction({ action, context: request.context, point: request.point, text: request.text });
  };
  const lookup = ({ sourceText, x, y }: Pick<import("../ui/model").TranslationDetail, "sourceText" | "x" | "y">) => {
    const term = getLookupTerm(sourceText);
    if (!term) return;
    if (options.requestAi) {
      void (translation as ReturnType<typeof createLlmTranslation>).request({ text: term, x, y, lookup: true });
    } else {
      void (translation as ReturnType<typeof createTranslation>).translate({ sourceText: term, x, y });
    }
  };

  return {
    close,
    destroy() {
      close();
      translation.cancel();
    },
    dismiss() {
      close();
      translation.cancel();
      options.closeAnnotation();
      options.updateUi({ translation: null });
    },
    open(request: TextContextRequest<Context>) {
      current = request;
      options.updateUi({ contextMenu: {
        menu: {
          canAnnotate: true,
          canCopy: true,
          canDelete: request.canDelete,
          canHighlight: request.canHighlight,
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
    downloadTranslation: "download" in translation ? translation.download : () => {},
    lookup,
    setTranslationSourceLanguage: "setSourceLanguage" in translation ? translation.setSourceLanguage : (_language: string | undefined | Promise<string | undefined>) => {},
  };
}
