import { useEffect, useState } from "react";
import { Check, Copy, Languages, X } from "lucide-react";
import { usePointPopover } from "./use-point-popover";
import type { TranslationDetail } from "../model";

export function TranslationPopover({ detail, onClose, onDownload }: {
  detail: TranslationDetail | null;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [detail]);

  const popover = usePointPopover({
    onDismiss: onClose,
    open: Boolean(detail),
    x: detail?.x ?? 0,
    y: detail?.y ?? 0,
  });

  if (!detail) return null;
  const translatedText = detail.translatedText?.trim() ?? "";
  const canCopy = detail.status === "success" && Boolean(translatedText);
  const targetLanguageName = getLanguageName(detail.targetLanguage);
  const translationDirection = detail.sourceLanguage
    ? `${getLanguageName(detail.sourceLanguage)} → ${targetLanguageName}`
    : targetLanguageName;

  return (
    <section
      aria-label="Translation"
      aria-live="polite"
      className="reader-text-popover"
      popover="manual"
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
                .then(() => setCopied(true))
                .catch((error) => console.warn("Failed to copy translation.", error));
            }}
          >
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button
            aria-label="Close translation"
            type="button"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="reader-text-popover-body">
        <p className="reader-text-popover-source">{detail.sourceText}</p>
        {detail.status === "success" ? (
          <p className="reader-text-popover-result">{translatedText}</p>
        ) : detail.status === "downloadable" ? (
          <button
            className="reader-text-popover-download"
            type="button"
            onClick={onDownload}
          >
            {translationDirection}: {detail.message ?? "Download this language model and translate."}
          </button>
        ) : (
          <p className={`reader-text-popover-message${detail.status === "error" ? " is-error" : ""}`}>
            {detail.message ?? "Translating..."}
            {typeof detail.progress === "number" ? ` ${Math.round(detail.progress * 100)}%` : ""}
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
