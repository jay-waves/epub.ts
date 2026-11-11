import { migrateLegacyAiSettings } from "../platform/browser-ai";
import { DEFAULT_TYPOGRAPHY_FONTS } from "../typography/model";
import type { TypographyFonts, TypographyTextAlignment } from "../typography/model";

export type AdvancedReaderSettings = {
  fonts: TypographyFonts;
  textAlignment: TypographyTextAlignment;
  translationEnabled: boolean;
  llmEnabled: boolean;
};

export interface SettingsActions {
  reset(): Promise<AdvancedReaderSettings>;
  setMonoFont(fontFamily: string): Promise<void>;
  setSansFont(fontFamily: string): Promise<void>;
  setSerifFont(fontFamily: string): Promise<void>;
  setTextAlignment(alignment: TypographyTextAlignment): Promise<void>;
  setTranslationEnabled(enabled: boolean): Promise<void>;
  setLlmEnabled(enabled: boolean): Promise<void>;
}

const STORAGE_KEY = "epub.ts:advanced-settings";

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
  const api = {
    setSerifFont: (fontFamily) => setFont("serif", fontFamily),
    setSansFont: (fontFamily) => setFont("sans", fontFamily),
    setMonoFont: (fontFamily) => setFont("mono", fontFamily),
    async setTextAlignment(textAlignment) {
      if (!isTextAlignment(textAlignment)) {
        throw new TypeError("textAlignment must be 'auto', 'start', or 'justify'.");
      }
      if (textAlignment === value.textAlignment) return;
      await commit({ ...value, textAlignment });
      console.log(`[epub.ts] Text alignment changed to "${textAlignment}". Default: "auto".`);
    },
    async setTranslationEnabled(translationEnabled) {
      await commit({ ...value, translationEnabled }, false);
    },
    async setLlmEnabled(llmEnabled) {
      await commit({ ...value, llmEnabled }, false);
    },
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
  } satisfies SettingsActions;

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
    setTextAlignment: api.setTextAlignment,
    setTranslationEnabled: api.setTranslationEnabled,
    setLlmEnabled: api.setLlmEnabled,
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
  if (settings.llmEnabled) overrides.llmEnabled = { current: "true", default: "false" };
  return overrides;
}

function getDefaults(): AdvancedReaderSettings {
  return {
    fonts: { ...DEFAULT_TYPOGRAPHY_FONTS },
    textAlignment: "auto",
    translationEnabled: true,
    llmEnabled: false,
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
      translationEnabled?: unknown;
      llmEnabled?: unknown;
      llmApiKey?: unknown;
      llmBaseUrl?: unknown;
      llmModel?: unknown;
      llmTranslationPrompt?: unknown;
    } | null;
    if (!saved) return defaults;
    if (["llmApiKey", "llmLookupPrompt", "llmBaseUrl", "llmModel", "llmTranslationPrompt"].some((key) => key in saved)) {
      migrateLegacyAiSettings(localStorage, saved);
      for (const key of ["llmApiKey", "llmLookupPrompt", "llmBaseUrl", "llmModel", "llmTranslationPrompt"]) {
        delete (saved as Record<string, unknown>)[key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
    if ('translationSourceLanguage' in saved || 'translationTargetLanguage' in saved) {
      delete saved.translationSourceLanguage;
      delete saved.translationTargetLanguage;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
    return {
      fonts: {
        serif: normalizeFontFamily(saved.fonts?.serif, defaults.fonts.serif),
        sans: normalizeFontFamily(saved.fonts?.sans, defaults.fonts.sans),
        mono: normalizeFontFamily(saved.fonts?.mono, defaults.fonts.mono),
      },
      textAlignment: isTextAlignment(saved.textAlignment) ? saved.textAlignment : "auto",
      translationEnabled: saved.translationEnabled !== false,
      llmEnabled: typeof saved.llmEnabled === "boolean" ? saved.llmEnabled : saved.translator === "llm",
    };
  } catch (error) {
    console.warn("[epub.ts] Could not read advanced settings; defaults are active.", error);
    return defaults;
  }
}

function persistSettings(settings: AdvancedReaderSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[epub.ts] Could not persist advanced settings.", error);
  }
}

function isTextAlignment(value: unknown): value is TypographyTextAlignment {
  return value === "auto" || value === "start" || value === "justify";
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
