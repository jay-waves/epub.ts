import { TranslationSettings } from "./translation-settings";
import { useEffect, useState } from "react";
import type { AdvancedReaderSettings, SettingsActions } from "../../advanced-settings";
import type { ViewerPlatform } from "../../../platform/types";
import { Dialog } from "./ui";
import { LlmSettings } from "./llm-settings";

export function SettingsDialog({ open, settings, actions, onClose, requestAi, getAiConfig, setAiConfig }: {
  open: boolean;
  settings: AdvancedReaderSettings;
  actions: SettingsActions;
  onClose: () => void;
  requestAi?: ViewerPlatform["requestAi"];
  getAiConfig?: ViewerPlatform["getAiConfig"];
  setAiConfig?: ViewerPlatform["setAiConfig"];
}) {
  const [values, setValues] = useState(() => fields(settings));
  const [translationEnabled, setTranslationEnabled] = useState(settings.translationEnabled);
  const [llmEnabled, setLlmEnabled] = useState(settings.llmEnabled);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setValues(fields(settings));
    setTranslationEnabled(settings.translationEnabled);
    setLlmEnabled(settings.llmEnabled);
    setError("");
  }, [open]);

  const update = (key: keyof ReturnType<typeof fields>, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    void commit(key, value, actions);
  };
  const reset = async () => {
    try {
      const defaults = await actions.reset();
      setValues(fields(defaults));
      setTranslationEnabled(defaults.translationEnabled);
      setLlmEnabled(defaults.llmEnabled);
      setError("");
    } catch { setError("Could not reset reader settings."); }
  };

  return <Dialog id="settings-modal" aria-label="Settings" className="settings-modal-box" onClose={onClose} open={open}>
    <div className="settings-form">
      <section className="settings-group" aria-label="Typography settings">
        <div className="settings-section-heading"><h2>Typography</h2><button className="settings-reset" type="button" onClick={() => void reset()}>Reset reader settings</button></div>
        <Setting label="Serif Font" value={values.serif} placeholder={settings.fonts.serif} onChange={(v) => update("serif", v)} />
        <Setting label="Sans Font" value={values.sans} placeholder={settings.fonts.sans} onChange={(v) => update("sans", v)} />
        <Setting label="Monospace Font" value={values.mono} placeholder={settings.fonts.mono} onChange={(v) => update("mono", v)} />
        <label className="settings-field"><span>Text Alignment</span><select value={values.alignment} onChange={(event) => update("alignment", event.target.value)}><option value="auto">Auto</option><option value="start">Start</option><option value="justify">Justify</option></select></label>
      </section>
      {open ? <>
        <LlmSettings enabled={llmEnabled} onEnabledChange={(value) => { setLlmEnabled(value); void actions.setLlmEnabled(value); }} requestAi={requestAi} getAiConfig={getAiConfig} setAiConfig={setAiConfig} />
        <TranslationSettings enabled={translationEnabled} llmEnabled={llmEnabled} onEnabledChange={(value) => { setTranslationEnabled(value); void actions.setTranslationEnabled(value); }} getAiConfig={getAiConfig} setAiConfig={setAiConfig} />
      </> : null}
      {error ? <p role="alert" className="settings-error">{error}</p> : null}
    </div>
  </Dialog>;
}

function Setting({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange(value: string): void }) {
  return <label className="settings-field"><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function fields(settings: AdvancedReaderSettings) {
  return { serif: settings.fonts.serif, sans: settings.fonts.sans, mono: settings.fonts.mono, alignment: settings.textAlignment };
}

async function commit(key: keyof ReturnType<typeof fields>, value: string, actions: SettingsActions) {
  try {
    if (key === "serif") return actions.setSerifFont(value);
    if (key === "sans") return actions.setSansFont(value);
    if (key === "mono") return actions.setMonoFont(value);
    if (key === "alignment" && (value === "auto" || value === "start" || value === "justify")) return actions.setTextAlignment(value);
  } catch { /* The field remains visibly empty until a valid value is entered. */ }
}
