import type { ViewerPlatform } from "../../../platform/types";
import { getBrowserDefaultLanguage } from "../../../platform/ai-prompt";
import { SettingsToggle } from "./settings-toggle";
import { useTranslationPrompt } from "./use-translation-prompt";

export function TranslationSettings({ enabled, llmEnabled, onEnabledChange, getAiConfig, setAiConfig }: {
  enabled: boolean;
  llmEnabled: boolean;
  onEnabledChange(enabled: boolean): void;
  getAiConfig?: ViewerPlatform["getAiConfig"];
  setAiConfig?: ViewerPlatform["setAiConfig"];
}) {
  const editor = useTranslationPrompt(getAiConfig, setAiConfig);
  return <section className="settings-group settings-translate" aria-label="Translate settings" onBlur={editor.save}>
    <div className="settings-section-heading"><div><h2>Translate</h2><p>{llmEnabled
      ? 'Uses the model and API key configured in LLM. The prompt controls the translation language.'
      : 'LLM is off. Translate opens Google Translate in a new tab.'}</p></div>
      <SettingsToggle label="Enable Translate" checked={enabled} onCheckedChange={onEnabledChange} />
    </div>
    <fieldset className="settings-fieldset" disabled={!enabled || !llmEnabled || !editor.loaded}>
      <label className="settings-field"><span>Translation Prompt</span><textarea rows={7} value={editor.prompt} onChange={(event) => editor.edit(event.target.value)} /></label>
      <p className="settings-hint">{'{{browserDefault}}'} uses your browser language ({getBrowserDefaultLanguage()}). Replace it with a language of your choice. {'{{selectedText}}'} inserts the selected text. Clear the prompt to restore the default.</p>
    </fieldset>
    {editor.error && <p role="alert" className="settings-error">{editor.error}</p>}
  </section>;
}
