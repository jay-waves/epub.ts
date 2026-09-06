import { emitViewerEvent, emitViewerSignal, VIEWER_EVENTS } from "../events";
import type { ContentContextAction } from "../events";
import { createTranslation } from "./translation";

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

type TextContextOptions = {
  getTranslationSourceLanguage: () => string | undefined;
  getTranslationTargetLanguage: () => string;
  openExternal: (url: string) => void;
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
export function createTextContext<Context>(options: TextContextOptions) {
  const translation = createTranslation({
    getSourceLanguage: options.getTranslationSourceLanguage,
    getTargetLanguage: options.getTranslationTargetLanguage,
  });
  const events = new EventTarget();
  let current: TextContextRequest<Context> | null = null;

  const clear = () => {
    if (!current) return;
    current = null;
    events.dispatchEvent(new Event("close"));
  };
  const close = () => {
    emitViewerSignal(VIEWER_EVENTS.contextMenuClose);
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
    events.dispatchEvent(new CustomEvent<TextContextActionDetail<Context>>("action", {
      detail: { action, context: request.context, point: request.point, text: request.text },
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
      emitViewerSignal(VIEWER_EVENTS.translationClose);
      emitViewerSignal(VIEWER_EVENTS.annotationClose);
    },
    open(request: TextContextRequest<Context>) {
      current = request;
      const canLookUp = request.canHighlight && Boolean(getLookupTerm(request.text));
      emitViewerEvent(VIEWER_EVENTS.contextMenuOpen, {
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
      });
    },
    setTranslationSourceLanguage: translation.setSourceLanguage,
  };
}
