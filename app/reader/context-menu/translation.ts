import type { TranslationDetail } from "../ui/model";
import type { ViewerPlatform } from "../../platform/types";

type TranslationRequest = { sourceText: string; x: number; y: number };

export function createTranslation(options: {
  requestAi?: ViewerPlatform["requestAi"];
  onUpdate(detail: TranslationDetail): void;
}) {
  let activeController: AbortController | null = null;
  const cancel = () => { activeController?.abort(); activeController = null; };
  const translate = async (request: TranslationRequest) => {
    cancel();
    const controller = new AbortController();
    activeController = controller;
    options.onUpdate({ ...request, status: "loading" });
    try {
      if (!options.requestAi) throw new Error("Configure LLM in Settings to translate.");
      const result = await options.requestAi({ text: request.sourceText, task: "translate" }, controller.signal, (translatedText) => {
        if (!controller.signal.aborted) options.onUpdate({ ...request, status: "loading", translatedText });
      });
      if (!controller.signal.aborted) options.onUpdate({ ...request, status: "success", translatedText: result });
    } catch (failure) {
      if (!controller.signal.aborted) options.onUpdate({ ...request, status: "error", message: failure instanceof Error ? failure.message : "Translation failed." });
    } finally {
      if (activeController === controller) activeController = null;
    }
  };
  return { translate, cancel };
}
