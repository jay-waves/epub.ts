import { DEFAULT_TYPOGRAPHY_FONTS } from "../typography/model";
import type { TypographyFonts, TypographyTextAlignment } from "../typography/model";

export type AdvancedReaderSettings = {
  fonts: TypographyFonts;
  textAlignment: TypographyTextAlignment;
  translationSourceLanguage: string | null;
  translationTargetLanguage: string;
  translator: "builtin" | "llm";
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmTranslationPrompt: string;
};

type EpubSettingsApi = {
  readonly fonts: TypographyFonts;
  readonly sourceLanguage: string | null;
  readonly textAlignment: TypographyTextAlignment;
  readonly translationTargetLanguage: string;
  readonly translator: "builtin" | "llm";
  readonly llmApiKey: string;
  readonly llmBaseUrl: string;
  readonly llmModel: string;
  reset(): Promise<AdvancedReaderSettings>;
  setMonoFont(fontFamily: string): Promise<void>;
  setSansFont(fontFamily: string): Promise<void>;
  setSerifFont(fontFamily: string): Promise<void>;
  setSourceLanguage(language: string | null): Promise<void>;
  setTextAlignment(alignment: TypographyTextAlignment): Promise<void>;
  setTranslationTargetLanguage(language: string): Promise<void>;
  setTranslator(mode: "builtin" | "llm"): Promise<void>;
  setLlmApiKey(apiKey: string): Promise<void>;
  setLlmBaseUrl(baseUrl: string): Promise<void>;
  setLlmModel(model: string): Promise<void>;
  setLlmTranslationPrompt(prompt: string): Promise<void>;
};

const STORAGE_KEY = "epub.ts:advanced-settings";
const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "zh-cn";
const DEFAULT_LLM_TRANSLATION_PROMPT = "Translate the following text into Chinese. Preserve meaning, tone, names, formatting, and paragraph breaks. Output only the translation.\n\n{{selectedText}}";
const LEGACY_DEFAULT_LLM_TRANSLATION_PROMPT = "Translate the following text into Chinese. Preserve meaning, tone, names, formatting, and paragraph breaks. Output only the translation.\n\n%s";

export function createAdvancedSettingsController(
  onChange: (settings: AdvancedReaderSettings) => Promise<void> | void,
) {
  let value = loadSettings();

  const commit = async (nextValue: AdvancedReaderSettings, apply = true) => {
    value = nextValue;
    persistSettings(value);
    if (apply) await onChange(value);
  };
  const setFont = async (role: keyof TypographyFonts, fontFamily: string) => {
    const nextFont = normalizeFontFamily(fontFamily, DEFAULT_TYPOGRAPHY_FONTS[role]);
    if (nextFont === value.fonts[role]) return;
    await commit({ ...value, fonts: { ...value.fonts, [role]: nextFont } });
    console.log(
      `[epub.ts] ${role} font changed to "${nextFont}". Default: "${DEFAULT_TYPOGRAPHY_FONTS[role]}".`,
    );
  };
  const api: EpubSettingsApi = {
    get fonts() {
      return { ...value.fonts };
    },
    get sourceLanguage() {
      return value.translationSourceLanguage;
    },
    get textAlignment() {
      return value.textAlignment;
    },
    get translationTargetLanguage() {
      return value.translationTargetLanguage;
    },
    get translator() { return value.translator; },
    get llmApiKey() { return value.llmApiKey; },
    get llmBaseUrl() { return value.llmBaseUrl; },
    get llmModel() { return value.llmModel; },
    setSerifFont: (fontFamily) => setFont("serif", fontFamily),
    setSansFont: (fontFamily) => setFont("sans", fontFamily),
    setMonoFont: (fontFamily) => setFont("mono", fontFamily),
    async setSourceLanguage(language) {
      const translationSourceLanguage = language == null ? null : normalizeLanguageTag(language);
      if (translationSourceLanguage === value.translationSourceLanguage) return;
      await commit({ ...value, translationSourceLanguage }, false);
      console.log(
        translationSourceLanguage
          ? `[epub.ts] Translation source language changed to "${translationSourceLanguage}".`
          : "[epub.ts] Translation source language reset to automatic detection.",
      );
    },
    async setTextAlignment(textAlignment) {
      if (!isTextAlignment(textAlignment)) {
        throw new TypeError("textAlignment must be 'auto', 'start', or 'justify'.");
      }
      if (textAlignment === value.textAlignment) return;
      await commit({ ...value, textAlignment });
      console.log(`[epub.ts] Text alignment changed to "${textAlignment}". Default: "auto".`);
    },
    async setTranslationTargetLanguage(language) {
      const translationTargetLanguage = normalizeLanguageTag(language);
      if (translationTargetLanguage === value.translationTargetLanguage) return;
      await commit({ ...value, translationTargetLanguage }, false);
      console.log(
        `[epub.ts] Translation target language changed to "${translationTargetLanguage}". Browser default: "${getBrowserLanguage()}".`,
      );
    },
    async setTranslator(translator) {
      if (translator !== "builtin" && translator !== "llm") throw new TypeError("Invalid translator.");
      if (translator !== value.translator) await commit({ ...value, translator }, false);
    },
    async setLlmApiKey(apiKey) {
      await commit({ ...value, llmApiKey: apiKey.trim() }, false);
      console.log("[epub.ts] LLM API key updated.");
    },
    async setLlmBaseUrl(baseUrl) {
      const normalized = baseUrl.trim().replace(/\/$/, "");
      await commit({ ...value, llmBaseUrl: normalized }, false);
      console.log(`[epub.ts] LLM base URL changed to "${normalized}".`);
    },
    async setLlmModel(model) {
      await commit({ ...value, llmModel: model.trim() }, false);
      console.log(`[epub.ts] LLM model changed to "${model.trim()}".`);
    },
    async setLlmTranslationPrompt(prompt) { await commit({ ...value, llmTranslationPrompt: prompt }, false); },
    async reset() {
      value = getDefaults();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.warn("[epub.ts] Could not clear advanced settings.", error);
      }
      await onChange(value);
      console.log("[epub.ts] Advanced settings reset to defaults.");
      return value;
    },
  };

  return {
    get value() {
      return value;
    },
    logStatus() {
      const overrides = getSettingsOverrides(value);
      if (!Object.keys(overrides).length) return false;
      console.log("[epub.ts] Active advanced setting overrides.", overrides);
      return true;
    },
    setSerifFont: api.setSerifFont,
    setSansFont: api.setSansFont,
    setMonoFont: api.setMonoFont,
    setSourceLanguage: api.setSourceLanguage,
    setTextAlignment: api.setTextAlignment,
    setTranslationTargetLanguage: api.setTranslationTargetLanguage,
    setTranslator: api.setTranslator,
    setLlmApiKey: api.setLlmApiKey,
    setLlmBaseUrl: api.setLlmBaseUrl,
    setLlmModel: api.setLlmModel,
    setLlmTranslationPrompt: api.setLlmTranslationPrompt,
    reset: api.reset,
  };
}

function getSettingsOverrides(settings: AdvancedReaderSettings) {
  const overrides: Record<string, { current: string; default: string }> = {};
  if (settings.fonts.serif !== DEFAULT_TYPOGRAPHY_FONTS.serif) {
    overrides.serifFont = { current: settings.fonts.serif, default: DEFAULT_TYPOGRAPHY_FONTS.serif };
  }
  if (settings.fonts.sans !== DEFAULT_TYPOGRAPHY_FONTS.sans) {
    overrides.sansFont = { current: settings.fonts.sans, default: DEFAULT_TYPOGRAPHY_FONTS.sans };
  }
  if (settings.fonts.mono !== DEFAULT_TYPOGRAPHY_FONTS.mono) {
    overrides.monoFont = { current: settings.fonts.mono, default: DEFAULT_TYPOGRAPHY_FONTS.mono };
  }
  if (settings.textAlignment !== "auto") {
    overrides.textAlignment = { current: settings.textAlignment, default: "auto" };
  }
  if (settings.translationSourceLanguage) {
    overrides.translationSourceLanguage = {
      current: settings.translationSourceLanguage,
      default: "auto",
    };
  }
  if (settings.translationTargetLanguage !== DEFAULT_TRANSLATION_TARGET_LANGUAGE) {
    overrides.translationTargetLanguage = {
      current: settings.translationTargetLanguage,
      default: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    };
  }
  if (settings.translator !== "builtin") overrides.translator = { current: settings.translator, default: "builtin" };
  return overrides;
}

function getDefaults(): AdvancedReaderSettings {
  return {
    fonts: { ...DEFAULT_TYPOGRAPHY_FONTS },
    textAlignment: "auto",
    translationSourceLanguage: null,
    translationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    translator: "builtin",
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "",
    llmTranslationPrompt: DEFAULT_LLM_TRANSLATION_PROMPT,
  };
}

function loadSettings(): AdvancedReaderSettings {
  const defaults = getDefaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
      fonts?: Partial<TypographyFonts>;
      textAlignment?: unknown;
      translationSourceLanguage?: unknown;
      translationTargetLanguage?: unknown;
      translator?: unknown;
      llmApiKey?: unknown;
      llmBaseUrl?: unknown;
      llmModel?: unknown;
      llmTranslationPrompt?: unknown;
    } | null;
    if (!saved) return defaults;
    if ("llmApiKey" in saved || "llmLookupPrompt" in saved) {
      delete saved.llmApiKey;
      delete (saved as { llmLookupPrompt?: unknown }).llmLookupPrompt;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
    return {
      fonts: {
        serif: normalizeFontFamily(saved.fonts?.serif, defaults.fonts.serif),
        sans: normalizeFontFamily(saved.fonts?.sans, defaults.fonts.sans),
        mono: normalizeFontFamily(saved.fonts?.mono, defaults.fonts.mono),
      },
      textAlignment: isTextAlignment(saved.textAlignment) ? saved.textAlignment : "auto",
      translationSourceLanguage: normalizeSavedLanguageTag(saved.translationSourceLanguage),
      translationTargetLanguage: normalizeLanguageTag(
        saved.translationTargetLanguage,
        defaults.translationTargetLanguage,
      ),
      translator: saved.translator === "llm" ? "llm" : "builtin",
      llmApiKey: "",
      llmBaseUrl: typeof saved.llmBaseUrl === "string" ? saved.llmBaseUrl : defaults.llmBaseUrl,
      llmModel: typeof saved.llmModel === "string" ? saved.llmModel : defaults.llmModel,
      llmTranslationPrompt: saved.llmTranslationPrompt === LEGACY_DEFAULT_LLM_TRANSLATION_PROMPT
        ? defaults.llmTranslationPrompt
        : typeof saved.llmTranslationPrompt === "string" ? saved.llmTranslationPrompt : defaults.llmTranslationPrompt,
    };
  } catch (error) {
    console.warn("[epub.ts] Could not read advanced settings; defaults are active.", error);
    return defaults;
  }
}

function persistSettings(settings: AdvancedReaderSettings) {
  try {
    const { llmApiKey: _llmApiKey, llmBaseUrl: _llmBaseUrl, llmModel: _llmModel, ...persisted } = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch (error) {
    console.warn("[epub.ts] Could not persist advanced settings.", error);
  }
}

function isTextAlignment(value: unknown): value is TypographyTextAlignment {
  return value === "auto" || value === "start" || value === "justify";
}

function getBrowserLanguage() {
  return normalizeLanguageTag(navigator.languages[0] ?? navigator.language, "en");
}

function normalizeLanguageTag(value: unknown, fallback?: string) {
  const language = typeof value === "string" ? value.trim().replaceAll("_", "-") : "";
  try {
    if (language) return (Intl.getCanonicalLocales(language)[0] ?? fallback ?? "en").toLowerCase();
  } catch {
    // Report invalid console input below; ignore invalid persisted values.
  }
  if (fallback) return fallback.toLowerCase();
  throw new TypeError("language must be a valid BCP 47 language tag, such as 'en' or 'zh-CN'.");
}

function normalizeSavedLanguageTag(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return normalizeLanguageTag(value);
  } catch {
    return null;
  }
}

function normalizeFontFamily(value: unknown, fallback: string) {
  const font = typeof value === "string"
    ? value.trim().replaceAll(/[\u0000-\u001f\u007f]/gu, "").slice(0, 1000)
    : "";
  const legacyNames: Record<string, string> = {
    "eb-garamond": fallback,
    "monaspace-argon": fallback,
    "noto-sans": "Noto Sans",
    "noto-serif": "Noto Serif",
    "system-mono": "ui-monospace",
    "system-sans": "system-ui",
    "system-serif": "ui-serif",
  };
  if (font && legacyNames[font]) return legacyNames[font];
  return font || fallback;
}
