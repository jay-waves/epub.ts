import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, MessageSquareMore, Pencil, Send, X } from "lucide-react";
import type { AiMessage, ViewerPlatform } from "../../../platform/types";
import { usePointPopover } from "./use-point-popover";
import { PopoverResizeHandle } from "./popover-resize-handle";

export function LlmPopover({ detail, requestAi, onClose }: {
  detail: { text: string; x: number; y: number };
  requestAi: NonNullable<ViewerPlatform["requestAi"]>;
  onClose(): void;
}) {
  const [text, setText] = useState(() => `${detail.text.trim().slice(0, 4000).split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n`);
  const [status, setStatus] = useState<"editing" | "loading" | "answer">("editing");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const history = useRef<AiMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const initialSize = useRef(true);
  const popover = usePointPopover({ open: true, onDismiss: onClose, x: detail.x, y: detail.y });

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { setCopied(false); }, [text]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    const panel = input?.parentElement;
    if (!input || !panel || !initialSize.current) return;
    initialSize.current = false;
    const height = Math.min(Math.max(144, input.scrollHeight), 280, window.innerHeight * 0.45);
    panel.style.height = `${height + panel.getBoundingClientRect().height - input.getBoundingClientRect().height}px`;
  }, []);
  useEffect(() => {
    if (status !== "editing") return;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    if (input) input.scrollTop = input.scrollHeight;
  }, [status]);

  const send = async () => {
    if (status !== "editing" || !text.trim() || controller.current) return;
    const prompt = text.trim();
    const active = new AbortController();
    controller.current = active;
    setStatus("loading");
    setError("");
    setText("");
    try {
      const answer = await requestAi({ text: prompt, history: history.current }, active.signal, (reply) => {
        if (!active.signal.aborted) setText(reply);
      });
      if (active.signal.aborted) return;
      history.current = [...history.current, { role: "user", content: prompt }, { role: "assistant", content: answer }];
      setText(answer);
      setStatus("answer");
    } catch (failure) {
      if (active.signal.aborted) return;
      setText(prompt);
      setStatus("editing");
      setError(failure instanceof Error ? failure.message : "LLM request failed.");
    } finally {
      if (controller.current === active) controller.current = null;
    }
  };

  return <section aria-label="Ask LLM" className="reader-text-popover reader-editor-popover" popover="manual"
    ref={popover.setPopover} role="dialog" style={popover.popoverStyle}>
    <header className="reader-text-popover-header">
      <div className="reader-text-popover-title"><MessageSquareMore size={16} aria-hidden="true" /><span>{status === "editing" ? "Ask" : "Response"}</span></div>
      <div className="reader-text-popover-actions">
        {status === "answer" ? <button type="button" aria-label="Ask a follow-up" title="Ask a follow-up" onClick={() => { setText(""); setStatus("editing"); }}><Pencil size={15} /></button>
          : <button type="button" aria-label={status === "loading" ? "Sending…" : "Send"} title="Send (Ctrl+Enter)" disabled={status !== "editing" || !text.trim()} onClick={() => void send()}><Send size={15} /></button>}
        <button type="button" aria-label={copied ? "Copied" : "Copy text"} title="Copy text" disabled={!text} onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setError("Could not copy text. Select the text and copy it manually."));
        }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
        <button type="button" aria-label="Close" title="Close" onClick={onClose}><X size={15} /></button>
      </div>
    </header>
    <textarea ref={inputRef} className="reader-text-popover-result reader-llm-input" value={text}
      aria-label={status === "editing" ? "Ask" : "LLM response"} aria-busy={status === "loading"}
      readOnly={status !== "editing"} placeholder={status === "loading" ? "Running LLM…" : history.current.length ? "Ask a follow-up…" : "Ask…"}
      onChange={(event) => setText(event.currentTarget.value)} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); }
      }} />
    {error ? <p role="alert" className="reader-text-popover-message is-error">{error}</p> : null}
    <PopoverResizeHandle />
  </section>;
}
