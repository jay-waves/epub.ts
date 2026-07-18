import { useEffect, useRef, useState } from "react";
import { Check, Copy, Languages, X } from "lucide-react";
import { useFloatingPosition } from "./floating-position";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { TranslationDetail } from "../viewer-events";
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
  targetLanguage: "zh",
  x: 0,
  y: 0,
};

export function TranslationPopover() {
  const [state, setState] = useState(closedState);
  const popoverRef = useRef<HTMLElement | null>(null);

  const show = (detail: TranslationDetail) => {
    setState({ ...detail, copied: false, open: true });
  };

  useViewerEvent(VIEWER_EVENTS.translationOpen, show);
  useViewerEvent(VIEWER_EVENTS.translationUpdate, show);
  useViewerEvent(VIEWER_EVENTS.translationClose, () => {
    setState((current) => ({ ...current, open: false }));
  });

  useEffect(() => {
    const requestClose = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-text-popover")) return;
      emitViewerEvent(VIEWER_EVENTS.translationClose);
    };

    window.addEventListener("pointerdown", requestClose);
    window.addEventListener("contextmenu", requestClose);
    window.addEventListener("keydown", requestClose);
    return () => {
      window.removeEventListener("pointerdown", requestClose);
      window.removeEventListener("contextmenu", requestClose);
      window.removeEventListener("keydown", requestClose);
    };
  }, []);

  const position = useFloatingPosition(
    popoverRef,
    { x: state.x, y: state.y },
    state.open,
    { fallbackHeight: 180, fallbackWidth: 340 },
  );

  if (!state.open) return null;

  const translatedText = state.translatedText?.trim() ?? "";
  const canCopy = state.status === "success" && Boolean(translatedText);

  return (
    <section
      aria-live="polite"
      className="reader-text-popover"
      ref={popoverRef}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="reader-text-popover-header">
        <div className="reader-text-popover-title">
          <Languages size={16} aria-hidden="true" />
          <span>Translate to Chinese</span>
        </div>
        <div className="reader-text-popover-actions">
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

      <div className="reader-text-popover-body">
        <p className="reader-text-popover-source">{state.sourceText}</p>
        {state.status === "success" ? (
          <p className="reader-text-popover-result">{translatedText}</p>
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
