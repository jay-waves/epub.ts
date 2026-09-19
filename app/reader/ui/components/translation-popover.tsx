import { BookOpen, ExternalLink, Languages } from "lucide-react";
import { usePointPopover } from "./use-point-popover";
import type { TranslationDetail } from "../model";

export function TranslationPopover({ detail, onClose, onDownload, onExternal, onLookup }: {
  detail: TranslationDetail | null;
  onClose: () => void;
  onDownload: () => void;
  onExternal: (detail: TranslationDetail) => void;
  onLookup: (detail: TranslationDetail) => void;
}) {
  const popover = usePointPopover({
    onDismiss: onClose,
    open: Boolean(detail),
    x: detail?.x ?? 0,
    y: detail?.y ?? 0,
  });

  if (!detail) return null;
  const translatedText = detail.translatedText?.trim() ?? "";
  const canLookUp = detail.kind !== "lookup" && isLookupTerm(detail.sourceText);
  const targetLanguageName = getLanguageName(detail.targetLanguage);
  const translationDirection = detail.sourceLanguage
    ? `${getLanguageName(detail.sourceLanguage)} → ${targetLanguageName}`
    : targetLanguageName;
  const externalUrl = detail.kind === "lookup"
    ? `https://en.wiktionary.org/wiki/${encodeURIComponent(detail.sourceText.trim())}`
    : `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(detail.targetLanguage)}&text=${encodeURIComponent(detail.sourceText)}&op=translate`;

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
          <span>{detail.kind === "lookup" ? "Dictionary" : `Translate to ${targetLanguageName}`}</span>
        </div>
        <div className="reader-text-popover-actions">
          {canLookUp ? (
            <button
              aria-label="Look up word"
              title="Look up word"
              type="button"
              onClick={() => onLookup(detail)}
            >
              <BookOpen size={15} aria-hidden="true" />
            </button>
          ) : null}
          <button
            aria-label="Open external link"
            title={externalUrl}
            type="button"
            onClick={() => onExternal(detail)}
          >
            <ExternalLink size={15} aria-hidden="true" />
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

function isLookupTerm(text: string) {
  const term = text.trim();
  return term.length <= 100
    && /^[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*$/u.test(term);
}

function getLanguageName(language: string) {
  try {
    const displayNames = new Intl.DisplayNames([navigator.language], { type: "language" });
    return displayNames.of(language) ?? language;
  } catch {
    return language;
  }
}
