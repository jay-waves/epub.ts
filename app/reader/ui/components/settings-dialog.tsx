import { useEffect, useRef, useState } from "react";
import type { AdvancedReaderSettings } from "../../advanced-settings";
import { Dialog } from "./ui";

type SettingsActions = {
  setSerifFont(value: string): Promise<void>;
  setSansFont(value: string): Promise<void>;
  setMonoFont(value: string): Promise<void>;
  setSourceLanguage(value: string | null): Promise<void>;
  setTextAlignment(value: "auto" | "start" | "justify"): Promise<void>;
  setTranslationTargetLanguage(value: string): Promise<void>;
  setLlmApiKey(value: string): Promise<void>;
  setLlmBaseUrl(value: string): Promise<void>;
  setLlmModel(value: string): Promise<void>;
  setLlmTranslationPrompt(value: string): Promise<void>;
  setLlmLookupPrompt(value: string): Promise<void>;
  reset(): Promise<void>;
};

export function SettingsDialog({ open, settings, actions, onClose, requestAi }: {
  open: boolean;
  settings: AdvancedReaderSettings;
  actions: SettingsActions;
  onClose: () => void;
  requestAi?: (request: import("../../../platform/types").AiRequest) => Promise<string>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState(() => fields(settings));
  const [testStatus, setTestStatus] = useState("");
  useEffect(() => setValues(fields(settings)), [settings]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);

  const update = (key: keyof ReturnType<typeof fields>, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    void commit(key, value, actions);
  };

  return <Dialog id="settings-modal" aria-labelledby="settings-dialog-title" className="settings-modal-box" onClose={onClose} ref={dialogRef}>
    <div className="settings-root">
      <header className="settings-header"><h2 id="settings-dialog-title">Settings</h2></header>
      <div className="settings-form">
        <Setting label="Serif font" value={values.serif} placeholder={settings.fonts.serif} onChange={(v) => update("serif", v)} />
        <Setting label="Sans font" value={values.sans} placeholder={settings.fonts.sans} onChange={(v) => update("sans", v)} />
        <Setting label="Monospace font" value={values.mono} placeholder={settings.fonts.mono} onChange={(v) => update("mono", v)} />
        <Setting label="Source language" value={values.source} placeholder="Auto detect" onChange={(v) => update("source", v)} />
        <Setting label="Target language" value={values.target} placeholder="zh-CN" onChange={(v) => update("target", v)} />
        <Setting label="Text alignment" value={values.alignment} placeholder="auto, start, or justify" onChange={(v) => update("alignment", v)} />
        <Setting label="LLM API key" value={values.apiKey} placeholder="Required for desktop AI" type="password" onChange={(v) => update("apiKey", v)} />
        <Setting label="LLM base URL" value={values.baseUrl} placeholder="https://api.openai.com/v1" onChange={(v) => update("baseUrl", v)} />
        <Setting label="LLM model" value={values.model} placeholder="Model name" onChange={(v) => update("model", v)} />
        <PromptSetting label="Translation prompt" value={values.translationPrompt} placeholder="Translation instructions" onChange={(v) => update("translationPrompt", v)} />
        <PromptSetting label="Lookup prompt" value={values.lookupPrompt} placeholder="Dictionary lookup instructions" onChange={(v) => update("lookupPrompt", v)} />
      </div>
      <div className="settings-actions">
        <button className="settings-reset" type="button" onClick={() => void actions.reset()}>Reset settings</button>
        <button className="settings-test" type="button" disabled={!requestAi} onClick={() => {
          if (!requestAi) return;
          setTestStatus("Testing…");
          void requestAi({ text: "hello", targetLanguage: "zh-cn", lookup: false, apiKey: values.apiKey || settings.llmApiKey, baseUrl: values.baseUrl, model: values.model, translationPrompt: values.translationPrompt, lookupPrompt: values.lookupPrompt })
            .then(() => setTestStatus("LLM connection successful."), (error: unknown) => setTestStatus(error instanceof Error ? error.message : "LLM connection failed."));
        }}>Test LLM</button>
        {testStatus ? <span className="settings-test-status" role="status">{testStatus}</span> : null}
      </div>
    </div>
  </Dialog>;
}

function Setting({ label, value, placeholder, type = "text", onChange }: { label: string; value: string; placeholder: string; type?: "text" | "password"; onChange(value: string): void }) {
  return <label className="settings-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PromptSetting({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange(value: string): void }) {
  return <label className="settings-field"><span>{label}</span><textarea value={value} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value)} /></label>;
}

function fields(settings: AdvancedReaderSettings) {
  return { serif: settings.fonts.serif, sans: settings.fonts.sans, mono: settings.fonts.mono, source: settings.translationSourceLanguage ?? "", target: settings.translationTargetLanguage, alignment: settings.textAlignment, apiKey: "", baseUrl: settings.llmBaseUrl, model: settings.llmModel, translationPrompt: settings.llmTranslationPrompt, lookupPrompt: settings.llmLookupPrompt };
}

async function commit(key: keyof ReturnType<typeof fields>, value: string, actions: SettingsActions) {
  try {
    if (key === "serif") return actions.setSerifFont(value);
    if (key === "sans") return actions.setSansFont(value);
    if (key === "mono") return actions.setMonoFont(value);
    if (key === "source") return actions.setSourceLanguage(value.trim() ? validLanguage(value) : null);
    if (key === "target") return actions.setTranslationTargetLanguage(validLanguage(value));
    if (key === "alignment" && (value === "auto" || value === "start" || value === "justify")) return actions.setTextAlignment(value);
    if (key === "apiKey") return actions.setLlmApiKey(value);
    if (key === "baseUrl") return actions.setLlmBaseUrl(value);
    if (key === "model") return actions.setLlmModel(value);
    if (key === "translationPrompt") return actions.setLlmTranslationPrompt(value);
    if (key === "lookupPrompt") return actions.setLlmLookupPrompt(value);
  } catch { /* The field remains visibly empty until a valid value is entered. */ }
}

function validLanguage(value: string) {
  const language = Intl.getCanonicalLocales(value.trim())[0];
  if (!language) throw new Error("Invalid language");
  return language.toLowerCase();
}
