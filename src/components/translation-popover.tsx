import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Languages, X } from "lucide-react";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { TranslationDetail } from "../viewer-events";

type TranslationState = TranslationDetail & {
  copied: boolean;
  open: boolean;
};

const closedState: TranslationState = {
  copied: false,
  open: false,
  sourceText: "",
  status: "loading",
  targetLanguage: "zh",
  x: 0,
  y: 0,
};

export function TranslationPopover() {
  const [state, setState] = useState<TranslationState>(closedState);

  useEffect(() => {
    const open = (detail: TranslationDetail) => {
      setState({ ...detail, copied: false, open: true });
    };
    const update = (detail: TranslationDetail) => {
      setState((current) => ({ ...current, ...detail, copied: false, open: true }));
    };
    const close = () => setState((current) => ({ ...current, open: false }));
    const requestClose = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-translation-popover")) return;
      close();
      emitViewerEvent(VIEWER_EVENTS.translationClose);
    };

    const stopOpen = listenViewerEvent(VIEWER_EVENTS.translationOpen, open);
    const stopUpdate = listenViewerEvent(VIEWER_EVENTS.translationUpdate, update);
    const stopClose = listenViewerEvent(VIEWER_EVENTS.translationClose, close);
    window.addEventListener("pointerdown", requestClose);
    window.addEventListener("contextmenu", requestClose);
    window.addEventListener("keydown", requestClose);
    return () => {
      stopOpen();
      stopUpdate();
      stopClose();
      window.removeEventListener("pointerdown", requestClose);
      window.removeEventListener("contextmenu", requestClose);
      window.removeEventListener("keydown", requestClose);
    };
  }, []);

  const position = useMemo(() => {
    const width = 340;
    const gutter = 12;
    return {
      left: Math.min(Math.max(state.x, gutter), window.innerWidth - width - gutter),
      top: Math.min(Math.max(state.y, gutter), window.innerHeight - gutter),
    };
  }, [state.x, state.y]);

  if (!state.open) return null;

  const translatedText = state.translatedText?.trim();
  const canCopy = state.status === "success" && Boolean(translatedText);

  return (
    <section
      className="reader-translation-popover"
      style={position}
      aria-live="polite"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="reader-translation-header">
        <div className="reader-translation-title">
          <Languages size={16} aria-hidden="true" />
          <span>Translate to Chinese</span>
        </div>
        <div className="reader-translation-actions">
          <button
            aria-label="Copy translation"
            disabled={!canCopy}
            type="button"
            onClick={() => {
              if (!translatedText) return;
              void navigator.clipboard.writeText(translatedText);
              setState((current) => ({ ...current, copied: true }));
            }}
          >
            {state.copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button
            aria-label="Close translation"
            type="button"
            onClick={() => emitViewerEvent(VIEWER_EVENTS.translationClose)}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="reader-translation-body">
        <p className="reader-translation-source">{state.sourceText}</p>
        {state.status === "success" ? (
          <p className="reader-translation-result">{translatedText}</p>
        ) : (
          <p className={`reader-translation-message ${state.status === "error" ? "is-error" : ""}`}>
            {state.message ?? "Translating..."}
            {typeof state.progress === "number" ? ` ${Math.round(state.progress * 100)}%` : ""}
          </p>
        )}
      </div>
    </section>
  );
}
