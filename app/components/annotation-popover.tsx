import { useEffect, useRef, useState } from "react";
import { Check, Copy, MessageSquareText, Trash2 } from "lucide-react";
import { useFloatingPosition } from "./floating-position";
import { emitViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { AnnotationDetail } from "../viewer-events";
import { useViewerEvent } from "./use-viewer-event";

type AnnotationState = AnnotationDetail & {
  copied: boolean;
  open: boolean;
};

const closedState: AnnotationState = {
  copied: false,
  note: "",
  open: false,
  sourceText: "",
  value: "",
  x: 0,
  y: 0,
};

export function AnnotationPopover() {
  const [state, setState] = useState(closedState);
  const stateRef = useRef(state);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const deletingRef = useRef(false);
  const popoverRef = useRef<HTMLElement | null>(null);

  const updateState = (update: (current: AnnotationState) => AnnotationState) => {
    setState((current) => {
      const next = update(current);
      stateRef.current = next;
      return next;
    });
  };

  useViewerEvent(VIEWER_EVENTS.annotationOpen, (detail) => {
    deletingRef.current = false;
    const next = { ...detail, copied: false, open: true };
    stateRef.current = next;
    setState(next);
  });
  useViewerEvent(VIEWER_EVENTS.annotationClose, () => {
    const current = stateRef.current;
    if (!deletingRef.current && current.open) {
      emitViewerEvent(VIEWER_EVENTS.annotationSave, { note: current.note, value: current.value });
    }
    deletingRef.current = false;
    updateState((value) => ({ ...value, open: false }));
  });

  useEffect(() => {
    if (!state.open) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [state.open, state.value]);

  useEffect(() => {
    const requestClose = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-text-popover")) return;
      emitViewerEvent(VIEWER_EVENTS.annotationClose);
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
    { fallbackHeight: 300, fallbackWidth: 340 },
  );

  if (!state.open) return null;

  const copyText = [state.sourceText, state.note.trim()].filter(Boolean).join("\n\n");

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
          <MessageSquareText size={16} aria-hidden="true" />
          <span>Annotation</span>
        </div>
        <div className="reader-text-popover-actions">
          <button
            aria-label="Copy annotation"
            disabled={!copyText}
            type="button"
            onClick={() => {
              if (!copyText) return;
              void navigator.clipboard.writeText(copyText);
              updateState((current) => ({ ...current, copied: true }));
            }}
          >
            {state.copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button
            aria-label="Delete annotation"
            type="button"
            onClick={() => {
              deletingRef.current = true;
              emitViewerEvent(VIEWER_EVENTS.annotationDelete, { value: state.value });
              updateState((current) => ({ ...current, open: false }));
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="reader-text-popover-body">
        <textarea className="reader-text-popover-source" readOnly value={state.sourceText} />
        <textarea
          aria-label="Annotation"
          className="reader-text-popover-result reader-annotation-input"
          onChange={(event) => {
            const note = event.target.value;
            updateState((current) => ({ ...current, copied: false, note }));
          }}
          placeholder="Write annotation..."
          ref={inputRef}
          value={state.note}
        />
      </div>
    </section>
  );
}
