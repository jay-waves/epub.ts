import { useEffect, useRef, useState } from "react";
import { Check, Copy, Languages, MessageSquareText, Trash2, X } from "lucide-react";
import { useFloatingPosition } from "./floating-position";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { AnnotationDetail, TranslationDetail } from "../viewer-events";

type TranslationState = TranslationDetail & {
  mode: "translate";
  copied: boolean;
  open: boolean;
};

type AnnotationState = AnnotationDetail & {
  copied: boolean;
  mode: "annotation";
  open: boolean;
};

type PopoverState = TranslationState | AnnotationState;

const closedState: PopoverState = {
  copied: false,
  mode: "translate",
  open: false,
  sourceText: "",
  status: "loading",
  targetLanguage: "zh",
  x: 0,
  y: 0,
};

export function TranslationPopover() {
  const [state, setState] = useState<PopoverState>(closedState);
  const annotationInputRef = useRef<HTMLTextAreaElement | null>(null);
  const deletingAnnotationRef = useRef(false);
  const popoverRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const annotationValue = state.mode === "annotation" ? state.value : "";

  useEffect(() => {
    if (state.mode !== "annotation" || !state.open) return;
    requestAnimationFrame(() => {
      annotationInputRef.current?.focus();
      annotationInputRef.current?.select();
    });
  }, [state.mode, state.open, annotationValue]);

  useEffect(() => {
    const open = (detail: TranslationDetail) => {
      setState({ ...detail, copied: false, mode: "translate", open: true });
    };
    const update = (detail: TranslationDetail) => {
      setState((current) => ({
        ...closedState,
        ...current,
        ...detail,
        copied: false,
        mode: "translate",
        open: true,
      }));
    };
    const openAnnotation = (detail: AnnotationDetail) => {
      deletingAnnotationRef.current = false;
      setState({ ...detail, copied: false, mode: "annotation", open: true });
    };
    const commitAnnotation = () => {
      if (deletingAnnotationRef.current) return;
      const current = stateRef.current;
      if (current.mode !== "annotation" || !current.open) return;
      emitViewerEvent(VIEWER_EVENTS.annotationSave, { note: current.note, value: current.value });
    };
    const close = () => {
      commitAnnotation();
      deletingAnnotationRef.current = false;
      setState((current) => ({ ...current, open: false }));
    };
    const closeTranslation = () => setState((current) => ({ ...current, open: false }));
    const requestClose = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-translation-popover")) return;
      const current = stateRef.current;
      emitViewerEvent(current.mode === "annotation" ? VIEWER_EVENTS.annotationClose : VIEWER_EVENTS.translationClose);
    };

    const stopOpen = listenViewerEvent(VIEWER_EVENTS.translationOpen, open);
    const stopUpdate = listenViewerEvent(VIEWER_EVENTS.translationUpdate, update);
    const stopClose = listenViewerEvent(VIEWER_EVENTS.translationClose, closeTranslation);
    const stopAnnotationOpen = listenViewerEvent(VIEWER_EVENTS.annotationOpen, openAnnotation);
    const stopAnnotationClose = listenViewerEvent(VIEWER_EVENTS.annotationClose, close);
    window.addEventListener("pointerdown", requestClose);
    window.addEventListener("contextmenu", requestClose);
    window.addEventListener("keydown", requestClose);
    return () => {
      stopOpen();
      stopUpdate();
      stopClose();
      stopAnnotationOpen();
      stopAnnotationClose();
      window.removeEventListener("pointerdown", requestClose);
      window.removeEventListener("contextmenu", requestClose);
      window.removeEventListener("keydown", requestClose);
    };
  }, []);

  const position = useFloatingPosition(
    popoverRef,
    { x: state.x, y: state.y },
    state.open,
    { fallbackHeight: state.mode === "annotation" ? 300 : 180, fallbackWidth: 340 },
  );

  if (!state.open) return null;

  const translatedText = state.mode === "translate" ? state.translatedText?.trim() : "";
  const canCopy = state.mode === "translate" && state.status === "success" && Boolean(translatedText);

  return (
    <section
      className="reader-translation-popover"
      ref={popoverRef}
      style={position}
      aria-live="polite"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="reader-translation-header">
        <div className="reader-translation-title">
          {state.mode === "annotation" ? (
            <MessageSquareText size={16} aria-hidden="true" />
          ) : (
            <Languages size={16} aria-hidden="true" />
          )}
          <span>{state.mode === "annotation" ? "Annotation" : "Translate to Chinese"}</span>
        </div>
        <div className="reader-translation-actions">
          {state.mode === "annotation" ? (
            <button
              aria-label="Copy annotation"
              type="button"
              onClick={() => {
                const note = state.note.trim();
                const text = note ? `${state.sourceText}\n\n${note}` : state.sourceText;
                void navigator.clipboard.writeText(text);
                setState((current) => current.mode === "annotation" ? { ...current, copied: true } : current);
              }}
            >
              {state.copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            </button>
          ) : (
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
          )}
          <button
            aria-label={state.mode === "annotation" ? "Delete annotation" : "Close translation"}
            type="button"
            onClick={() => {
              if (state.mode === "annotation") {
                deletingAnnotationRef.current = true;
                emitViewerEvent(VIEWER_EVENTS.annotationDelete, { value: state.value });
                setState((current) => ({ ...current, open: false }));
                return;
              }
              emitViewerEvent(VIEWER_EVENTS.translationClose);
            }}
          >
            {state.mode === "annotation" ? <Trash2 size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="reader-translation-body">
        {state.mode === "annotation" ? (
          <>
            <textarea className="reader-translation-source" readOnly value={state.sourceText} />
            <textarea
              aria-label="Annotation"
              className="reader-translation-result reader-annotation-input"
              onChange={(event) => {
                const note = event.target.value;
                setState((current) => current.mode === "annotation" ? { ...current, copied: false, note } : current);
              }}
              placeholder="Write annotation..."
              ref={annotationInputRef}
              value={state.note}
            />
          </>
        ) : state.status === "success" ? (
          <>
            <p className="reader-translation-source">{state.sourceText}</p>
            <p className="reader-translation-result">{translatedText}</p>
          </>
        ) : (
          <>
            <p className="reader-translation-source">{state.sourceText}</p>
            <p className={`reader-translation-message ${state.status === "error" ? "is-error" : ""}`}>
              {state.message ?? "Translating..."}
              {typeof state.progress === "number" ? ` ${Math.round(state.progress * 100)}%` : ""}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
