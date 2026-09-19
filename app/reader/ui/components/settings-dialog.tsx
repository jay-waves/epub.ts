import { useEffect, useRef, useState } from "react";
import type { AdvancedReaderSettings } from "../../advanced-settings";
import { buildLlmPrompt } from "../../context-menu/llm-prompt";
import { Dialog } from "./ui";

type SettingsActions = {
  setSerifFont(value: string): Promise<void>;
  setSansFont(value: string): Promise<void>;
  setMonoFont(value: string): Promise<void>;
  setSourceLanguage(value: string | null): Promise<void>;
  setTextAlignment(value: "auto" | "start" | "justify"): Promise<void>;
  setTranslationTargetLanguage(value: string): Promise<void>;
  setTranslator(mode: "builtin" | "llm"): Promise<void>;
  setLlmApiKey(value: string): Promise<void>;
  setLlmBaseUrl(value: string): Promise<void>;
  setLlmModel(value: string): Promise<void>;
  setLlmTranslationPrompt(value: string): Promise<void>;
  reset(): Promise<AdvancedReaderSettings>;
};

export function SettingsDialog({ open, settings, actions, onClose, requestAi, getAiConfig, setAiConfig }: {
  open: boolean;
  settings: AdvancedReaderSettings;
  actions: SettingsActions;
  onClose: () => void;
  requestAi?: (request: import("../../../platform/types").AiRequest) => Promise<string>;
  getAiConfig?: () => Promise<import("../../../platform/types").AiConfig>;
  setAiConfig?: (config: import("../../../platform/types").AiConfigUpdate) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState(() => fields(settings));
  const [testStatus, setTestStatus] = useState("");
  const [backendConfig, setBackendConfig] = useState<import("../../../platform/types").AiConfig | null>(null);
  const [section, setSection] = useState<"general" | "llm">("general");
  const editRevision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!open) return;
    editRevision.current++;
    setValues(fields(settings));
    setTestStatus("");
    setBackendConfig(null);
  }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open || !getAiConfig) return;
    let cancelled = false;
    const revision = editRevision.current;
    void saveQueue.current.catch(() => {}).then(getAiConfig).then((config) => {
      if (cancelled) return;
      if (revision === editRevision.current) {
        setBackendConfig(config);
        setValues((current) => ({ ...current, baseUrl: config.baseUrl, model: config.model }));
      }
    }).catch((error: unknown) => {
      if (!cancelled) setTestStatus(error instanceof Error ? error.message : "Could not load LLM settings.");
    });
    return () => { cancelled = true; };
  }, [open, getAiConfig]);

  const queueBackendUpdate = (config: import("../../../platform/types").AiConfigUpdate) => {
    if (!setAiConfig) return Promise.resolve();
    const next = saveQueue.current.catch(() => {}).then(() => setAiConfig(config));
    saveQueue.current = next;
    return next;
  };

  const update = (key: keyof ReturnType<typeof fields>, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setTestStatus("");
    if (key !== "apiKey" && key !== "baseUrl" && key !== "model") {
      void commit(key, value, actions);
    }
    if (key === "apiKey" || key === "baseUrl" || key === "model") {
      const revision = ++editRevision.current;
      void queueBackendUpdate({ [key]: value }).then(() => {
        if (revision === editRevision.current && key === "apiKey") {
          setBackendConfig((current) => ({
            apiKeyConfigured: Boolean(value),
            baseUrl: current?.baseUrl ?? values.baseUrl,
            model: current?.model ?? values.model,
          }));
        }
      }, (error: unknown) => {
        if (revision === editRevision.current) {
          setTestStatus(error instanceof Error ? error.message : "Could not save LLM settings.");
        }
      });
    }
  };

  const reset = async () => {
    try {
      await queueBackendUpdate({ apiKey: "", baseUrl: "", model: "" });
      const defaults = await actions.reset();
      editRevision.current++;
      setValues(fields(defaults));
      setBackendConfig({ apiKeyConfigured: false, baseUrl: "", model: "" });
      setTestStatus("");
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : "Could not reset settings.");
    }
  };

  const testConnection = async () => {
    if (!requestAi) return;
    setTestStatus("Testing…");
    try {
      await saveQueue.current;
      await requestAi({ prompt: buildLlmPrompt(values.translationPrompt, "hello") });
      setTestStatus("LLM connection successful.");
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : "LLM connection failed.");
    }
  };

  return <Dialog id="settings-modal" aria-labelledby="settings-dialog-title" className="settings-modal-box" onClose={onClose} ref={dialogRef}>
    <div className="settings-root">
      <header className="settings-header"><h2 id="settings-dialog-title">Settings</h2><nav aria-label="Settings sections" className="settings-tabs" role="tablist"><button type="button" role="tab" onClick={() => setSection("general")} aria-selected={section === "general"}>General</button><button type="button" role="tab" onClick={() => setSection("llm")} aria-selected={section === "llm"}>LLM</button></nav></header>
      <div className={`settings-form${section === "llm" ? " settings-form-llm" : ""}`} role="tabpanel">
        {section === "general" ? <>
        <Setting label="Serif font" value={values.serif} placeholder={settings.fonts.serif} onChange={(v) => update("serif", v)} />
        <Setting label="Sans font" value={values.sans} placeholder={settings.fonts.sans} onChange={(v) => update("sans", v)} />
        <Setting label="Monospace font" value={values.mono} placeholder={settings.fonts.mono} onChange={(v) => update("mono", v)} />
        <Setting label="Text alignment" value={values.alignment} placeholder="auto, start, or justify" onChange={(v) => update("alignment", v)} />
        <div className="settings-language-row">
          <Setting label="Source language" value={values.source} placeholder="Auto detect" onChange={(v) => update("source", v)} />
          <Setting label="Target language" value={values.target} placeholder="zh-CN" onChange={(v) => update("target", v)} />
        </div>
        <label className="settings-field"><span>Translator</span><select value={values.translator} onChange={(event) => update("translator", event.target.value)}><option value="builtin">Browser built-in</option><option value="llm" disabled={!requestAi}>LLM API</option></select></label>
        </> : <>
        <Setting label="LLM API key" value={values.apiKey} placeholder={backendConfig?.apiKeyConfigured ? "********" : "Required for desktop AI"} type="password" onChange={(v) => update("apiKey", v)} />
        <Setting label="LLM base URL (include https://)" value={values.baseUrl} placeholder="https://api.deepseek.com" onChange={(v) => update("baseUrl", v)} />
        <Setting label="LLM model" value={values.model} placeholder="Model name" onChange={(v) => update("model", v)} />
        <PromptSetting label="Translation prompt" value={values.translationPrompt} placeholder="Translation instructions" onChange={(v) => update("translationPrompt", v)} />
        </>}
      </div>
      {section === "llm" ? <div className="settings-actions">
        <button className="settings-reset" type="button" onClick={() => void reset()}>Reset</button>
        <button className="settings-test" type="button" disabled={!requestAi} onClick={() => void testConnection()}>Test LLM</button>
        {testStatus ? <span className="settings-test-status" role="status">{testStatus}</span> : null}
      </div> : null}
    </div>
  </Dialog>;
}

function Setting({ label, value, placeholder, type = "text", onChange }: { label: string; value: string; placeholder: string; type?: "text" | "password"; onChange(value: string): void }) {
  return <label className="settings-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PromptSetting({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange(value: string): void }) {
  return <label className="settings-field settings-field-prompt"><span>{label}</span><textarea value={value} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value)} /></label>;
}

function fields(settings: AdvancedReaderSettings) {
  return { serif: settings.fonts.serif, sans: settings.fonts.sans, mono: settings.fonts.mono, source: settings.translationSourceLanguage ?? "", target: settings.translationTargetLanguage, translator: settings.translator, alignment: settings.textAlignment, apiKey: "", baseUrl: settings.llmBaseUrl, model: settings.llmModel, translationPrompt: settings.llmTranslationPrompt };
}

async function commit(key: keyof ReturnType<typeof fields>, value: string, actions: SettingsActions) {
  try {
    if (key === "serif") return actions.setSerifFont(value);
    if (key === "sans") return actions.setSansFont(value);
    if (key === "mono") return actions.setMonoFont(value);
    if (key === "source") return actions.setSourceLanguage(value.trim() ? validLanguage(value) : null);
    if (key === "target") return actions.setTranslationTargetLanguage(validLanguage(value));
    if (key === "translator" && (value === "builtin" || value === "llm")) return actions.setTranslator(value);
    if (key === "alignment" && (value === "auto" || value === "start" || value === "justify")) return actions.setTextAlignment(value);
    if (key === "apiKey") return actions.setLlmApiKey(value);
    if (key === "baseUrl") return actions.setLlmBaseUrl(value);
    if (key === "model") return actions.setLlmModel(value);
    if (key === "translationPrompt") return actions.setLlmTranslationPrompt(value);
  } catch { /* The field remains visibly empty until a valid value is entered. */ }
}

function validLanguage(value: string) {
  const language = Intl.getCanonicalLocales(value.trim())[0];
  if (!language) throw new Error("Invalid language");
  return language.toLowerCase();
}
