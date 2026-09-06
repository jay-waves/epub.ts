import { useEffect, useRef, useState } from "react";
import { Check, Copy, SquarePen, Trash2 } from "lucide-react";
import { usePointPopover } from "./use-point-popover";
import type { AnnotationDetail } from "../model";

export function AnnotationPopover({ detail, onChange, onClose, onDelete }: {
  detail: AnnotationDetail | null;
  onChange: (note: string) => void;
  onClose: () => void;
  onDelete: (value: string) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
    if (!detail) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [detail]);

  const popover = usePointPopover({
    onDismiss: onClose,
    open: Boolean(detail),
    x: detail?.x ?? 0,
    y: detail?.y ?? 0,
  });

  if (!detail) return null;
  const copyText = [detail.sourceText, detail.note.trim()].filter(Boolean).join("\n\n");

  return (
    <section
      aria-label="Annotation"
      aria-live="polite"
      className="reader-text-popover"
      popover="manual"
      ref={popover.setPopover}
      role="dialog"
      style={popover.popoverStyle}
    >
      <header className="reader-text-popover-header">
        <div className="reader-text-popover-title">
          <SquarePen size={16} aria-hidden="true" />
          <span>Annotation</span>
        </div>
        <div className="reader-text-popover-actions">
          <button
            aria-label="Copy annotation"
            disabled={!copyText}
            type="button"
            onClick={() => {
              if (!copyText) return;
              void navigator.clipboard.writeText(copyText)
                .then(() => setCopied(true))
                .catch((error) => console.warn("Failed to copy annotation.", error));
            }}
          >
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button
            aria-label="Delete annotation"
            type="button"
            onClick={() => onDelete(detail.value)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="reader-text-popover-body">
        <textarea aria-label="Selected text" className="reader-text-popover-source" readOnly value={detail.sourceText} />
        <textarea
          aria-label="Annotation"
          className="reader-text-popover-result reader-annotation-input"
          onChange={(event) => {
            setCopied(false);
            onChange(event.target.value);
          }}
          placeholder="Write annotation..."
          ref={inputRef}
          value={detail.note}
        />
      </div>
    </section>
  );
}
