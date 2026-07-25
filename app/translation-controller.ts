import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";

type TranslationResource = {
  destroy?: () => void;
};

type BuiltInAiGlobals = typeof globalThis & {
  LanguageDetector?: LanguageDetectorConstructor;
  Translator?: TranslatorConstructor;
};

type TranslationRequest = {
  sourceText: string;
  x: number;
  y: number;
};

const targetLanguage = "zh";

class ModelUnavailableError extends Error {}

function googleTranslateUrl(text: string) {
  const query = new URLSearchParams({ sl: "auto", tl: "zh-CN", text, op: "translate" });
  return `https://translate.google.com/?${query}`;
}

export function createTranslationController(options: {
  modelPolicy: "allow-download" | "external-fallback";
  openExternal: (url: string) => void;
}) {
  const builtInAi = globalThis as BuiltInAiGlobals;
  let activeResource: TranslationResource | null = null;
  let runId = 0;

  const release = (resource = activeResource) => {
    if (!resource) return;
    if (activeResource === resource) activeResource = null;
    try {
      resource.destroy?.();
    } catch {
      // The browser may already have released a cancelled built-in AI session.
    }
  };

  const cancel = () => {
    ++runId;
    release();
  };

  const ensureUsable = (availability: BuiltInAiAvailability, modelName: string) => {
    if (availability === "unavailable") {
      throw new ModelUnavailableError(`${modelName} is not available in this browser.`);
    }
    if (options.modelPolicy === "external-fallback" && availability !== "available") {
      throw new ModelUnavailableError(`${modelName} is not installed.`);
    }
  };

  const useResource = async <Resource extends TranslationResource, Result>(
    resourcePromise: Promise<Resource>,
    currentRunId: number,
    action: (resource: Resource) => Promise<Result>,
  ) => {
    const resource = await resourcePromise;
    if (currentRunId !== runId) {
      release(resource);
      return undefined;
    }

    activeResource = resource;
    try {
      return await action(resource);
    } finally {
      release(resource);
    }
  };

  const detectLanguage = async (text: string, currentRunId: number) => {
    const { LanguageDetector } = builtInAi;
    if (!LanguageDetector) {
      throw new ModelUnavailableError("Built-in language detection is not available in this browser.");
    }

    const availability = await LanguageDetector.availability();
    ensureUsable(availability, "The built-in language model");
    const results = await useResource(
      LanguageDetector.create(),
      currentRunId,
      (detector) => detector.detect(text),
    );
    const [result] = results ?? [];
    return result?.confidence && result.confidence >= 0.45 ? result.detectedLanguage : "en";
  };

  const translate = async ({ sourceText, x, y }: TranslationRequest) => {
    cancel();
    const currentRunId = runId;
    const baseDetail = {
      sourceText,
      status: "loading" as const,
      targetLanguage,
      x,
      y,
    };

    emitViewerEvent(VIEWER_EVENTS.translationOpen, {
      ...baseDetail,
      message: "Translating to Chinese...",
    });

    try {
      const { Translator } = builtInAi;
      if (!Translator) {
        throw new ModelUnavailableError("Built-in translation is not available in this browser.");
      }

      const sourceLanguage = await detectLanguage(sourceText, currentRunId);
      if (currentRunId !== runId) return;
      if (sourceLanguage === targetLanguage || sourceLanguage.toLowerCase().startsWith("zh")) {
        emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
          ...baseDetail,
          message: "Selected text is already Chinese.",
          sourceLanguage,
          status: "success",
          translatedText: sourceText,
        });
        return;
      }

      const languagePair = { sourceLanguage, targetLanguage };
      const availability = await Translator.availability(languagePair);
      if (currentRunId !== runId) return;
      ensureUsable(availability, "The built-in translation model");

      const translatedText = await useResource(
        Translator.create({
          ...languagePair,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              if (currentRunId !== runId) return;
              emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
                ...baseDetail,
                message: "Downloading the built-in translation model...",
                progress: event.loaded,
                sourceLanguage,
              });
            });
          },
        }),
        currentRunId,
        async (translator) => {
          await translator.ready;
          return translator.translate(sourceText);
        },
      );
      if (currentRunId !== runId || translatedText == null) return;

      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        sourceLanguage,
        status: "success",
        translatedText,
      });
    } catch (error) {
      if (currentRunId !== runId) return;
      if (error instanceof ModelUnavailableError) {
        options.openExternal(googleTranslateUrl(sourceText));
        emitViewerEvent(VIEWER_EVENTS.translationClose);
        return;
      }
      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        message: error instanceof Error ? error.message : "Translation failed.",
        status: "error",
      });
    }
  };

  const stopListening = listenViewerEvent(VIEWER_EVENTS.translationClose, cancel);

  return {
    cancel,
    destroy: () => {
      cancel();
      stopListening();
    },
    translate,
  };
}
