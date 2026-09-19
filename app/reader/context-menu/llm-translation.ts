import type { TranslationDetail } from "../ui/model";
import type { AiRequest } from "../../platform/types";
import { buildLlmPrompt } from "./llm-prompt";

type Request = { text: string; x: number; y: number; lookup: boolean };
type Options = {
  getTranslationPrompt: () => string;
  requestAi: (request: AiRequest) => Promise<string>;
  onUpdate: (detail: TranslationDetail) => void;
};

export function createLlmTranslation(options: Options) {
  let controller: AbortController | undefined;

  const request = async ({ text, x, y, lookup }: Request) => {
    controller?.abort();
    controller = new AbortController();
    const targetLanguage = "zh-cn";
    const base = { kind: lookup ? "lookup" as const : "translation" as const, sourceText: text, targetLanguage, x, y, status: "loading" as const };
    options.onUpdate({ ...base, message: lookup ? "Looking up…" : "Translating…" });
    try {
      const result = await options.requestAi({ prompt: buildLlmPrompt(options.getTranslationPrompt(), text) });
      if (controller.signal.aborted) return;
      options.onUpdate({ ...base, status: "success", translatedText: result.trim() });
    } catch (error) {
      if (controller.signal.aborted) return;
      options.onUpdate({ ...base, status: "error", message: error instanceof Error ? error.message : "The LLM request failed." });
    }
  };

  return { request, cancel: () => controller?.abort() };
}
