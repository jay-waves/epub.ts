import { useEffect, useState } from "react";
import { BookOpen, Check, Copy, ExternalLink, Languages } from "lucide-react";
import { usePointPopover } from "./use-point-popover";
import { googleTranslationUrl } from "../../context-menu/translation-url";
import type { TranslationDetail } from "../model";

export function TranslationPopover({ detail, onClose, onExternal, onLookup }: {
  detail: TranslationDetail | null;
  onClose(): void;
  onExternal(detail: TranslationDetail): void;
  onLookup(detail: TranslationDetail): void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [detail?.translatedText]);
  const popover = usePointPopover({ onDismiss: onClose, open: Boolean(detail), x: detail?.x ?? 0, y: detail?.y ?? 0 });
  if (!detail) return null;
  const canLookUp = detail.sourceText.length <= 100 && /^[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*$/u.test(detail.sourceText.trim());
  return <section aria-label="Translate" className="reader-text-popover" popover="manual" ref={popover.setPopover} role="dialog" style={popover.popoverStyle}>
    <header className="reader-text-popover-header">
      <div className="reader-text-popover-title"><Languages size={16} aria-hidden="true" /><span>Translate</span></div>
      <div className="reader-text-popover-actions">
        {canLookUp ? <button aria-label="Look up word in Wiktionary" title="Look up word in Wiktionary" type="button" onClick={() => onLookup(detail)}><BookOpen size={15} /></button> : null}
        <button aria-label={copied ? "Copied" : "Copy translation"} title="Copy translation" disabled={!detail.translatedText} type="button" onClick={() => {
          void navigator.clipboard.writeText(detail.translatedText ?? "").then(() => setCopied(true)).catch(() => {});
        }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
        <button aria-label="Open in Google Translate" title={googleTranslationUrl(detail.sourceText)} type="button" onClick={() => onExternal(detail)}><ExternalLink size={15} /></button>
      </div>
    </header>
    <div className="reader-text-popover-body" aria-busy={detail.status === "loading"}>
      <p className="reader-text-popover-source">{detail.sourceText}</p>
      {detail.translatedText ? <p className="reader-text-popover-result">{detail.translatedText}</p> : null}
      {detail.status === "error" ? <p role="alert" className="reader-text-popover-message is-error">{detail.message}</p>
        : detail.status === "loading" && !detail.translatedText ? <p className="reader-text-popover-message">Translating with LLM…</p> : null}
    </div>
  </section>;
}
