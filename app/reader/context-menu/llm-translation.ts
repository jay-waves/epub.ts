import type { TranslationDetail } from "../ui/model";
import type { AiRequest } from "../../platform/types";

type Request = { text: string; x: number; y: number; lookup: boolean };
type Options = {
  getApiKey: () => string;
  getBaseUrl: () => string;
  getModel: () => string;
  getTargetLanguage: () => string;
  requestAi: (request: AiRequest) => Promise<string>;
  getTranslationPrompt: () => string;
  getLookupPrompt: () => string;
  onUpdate: (detail: TranslationDetail) => void;
};

export function createLlmTranslation(options: Options) {
  let controller: AbortController | undefined;

  const request = async ({ text, x, y, lookup }: Request) => {
    controller?.abort();
    controller = new AbortController();
    const targetLanguage = options.getTargetLanguage();
    const base = { kind: lookup ? "lookup" as const : "translation" as const, sourceText: text, targetLanguage, x, y, status: "loading" as const };
    options.onUpdate({ ...base, message: lookup ? "Looking up…" : "Translating…" });
    try {
      const apiKey = options.getApiKey();
      const baseURL = options.getBaseUrl();
      const modelName = options.getModel();
      if (!apiKey || !baseURL || !modelName) {
        throw new Error("Configure the LLM token, base URL, and model in the console advanced settings first.");
      }
      const result = await options.requestAi({ text, targetLanguage, lookup, apiKey, baseUrl: baseURL, model: modelName, translationPrompt: options.getTranslationPrompt(), lookupPrompt: options.getLookupPrompt() });
      if (controller.signal.aborted) return;
      options.onUpdate({ ...base, status: "success", translatedText: result.trim() });
    } catch (error) {
      if (controller.signal.aborted) return;
      options.onUpdate({ ...base, status: "error", message: error instanceof Error ? error.message : "The LLM request failed." });
    }
  };

  return { request, cancel: () => controller?.abort() };
}
