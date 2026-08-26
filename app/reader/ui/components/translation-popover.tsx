import { useState } from "react";
import { Check, Copy, Languages, X } from "lucide-react";
import { usePointPopover } from "./use-point-popover";
import { emitViewerEvent, VIEWER_EVENTS } from "../../events";
import type { TranslationDetail } from "../../events";
import { useViewerEvent } from "./use-viewer-event";

type TranslationState = TranslationDetail & {
  copied: boolean;
  open: boolean;
};

const closedState: TranslationState = {
  copied: false,
  open: false,
  sourceText: "",
  status: "loading",
  targetLanguage: navigator.languages[0] ?? navigator.language ?? "en",
  x: 0,
  y: 0,
};

export function TranslationPopover() {
  const [state, setState] = useState(closedState);

  const show = (detail: TranslationDetail) => {
    setState({ ...detail, copied: false, open: true });
  };

  useViewerEvent(VIEWER_EVENTS.translationOpen, show);
  useViewerEvent(VIEWER_EVENTS.translationUpdate, show);
  useViewerEvent(VIEWER_EVENTS.translationClose, () => {
    setState((current) => ({ ...current, open: false }));
  });

  const popover = usePointPopover({
    onDismiss: () => emitViewerEvent(VIEWER_EVENTS.translationClose),
    open: state.open,
    x: state.x,
    y: state.y,
  });

  const translatedText = state.translatedText?.trim() ?? "";
  const canCopy = state.status === "success" && Boolean(translatedText);
  const targetLanguageName = getLanguageName(state.targetLanguage);
  const translationDirection = state.sourceLanguage
    ? `${getLanguageName(state.sourceLanguage)} → ${targetLanguageName}`
    : targetLanguageName;

  if (!state.open) return null;
  return (
    <section
        aria-label="Translation"
        aria-live="polite"
        className="reader-text-popover"
        popover="auto"
        ref={popover.setPopover}
        role="dialog"
        style={popover.popoverStyle}
      >
      <header className="reader-text-popover-header">
        <div className="reader-text-popover-title">
          <Languages size={16} aria-hidden="true" />
          <span>Translate to {targetLanguageName}</span>
        </div>
        <div className="reader-text-popover-actions">
          <button
            aria-label="Copy translation"
            disabled={!canCopy}
            type="button"
            onClick={() => {
              if (!translatedText) return;
              void navigator.clipboard.writeText(translatedText)
                .then(() => setState((current) => ({ ...current, copied: true })))
                .catch((error) => console.warn("Failed to copy translation.", error));
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

      <div className="reader-text-popover-body">
        <p className="reader-text-popover-source">{state.sourceText}</p>
        {state.status === "success" ? (
          <p className="reader-text-popover-result">{translatedText}</p>
        ) : state.status === "downloadable" ? (
          <button
            className="reader-text-popover-download"
            type="button"
            onClick={() => emitViewerEvent(VIEWER_EVENTS.translationDownload)}
          >
            {translationDirection}: {state.message ?? "Download this language model and translate."}
          </button>
        ) : (
          <p className={`reader-text-popover-message${state.status === "error" ? " is-error" : ""}`}>
            {state.message ?? "Translating..."}
            {typeof state.progress === "number" ? ` ${Math.round(state.progress * 100)}%` : ""}
          </p>
        )}
      </div>
    </section>
  );
}

function getLanguageName(language: string) {
  try {
    const displayNames = new Intl.DisplayNames([navigator.language], { type: "language" });
    return displayNames.of(language) ?? language;
  } catch {
    return language;
  }
}
