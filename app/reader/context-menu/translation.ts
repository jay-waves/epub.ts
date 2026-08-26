import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../events";

type BuiltInAiAvailability = "available" | "downloadable" | "downloading" | "unavailable";

type BuiltInAiMonitor = {
  addEventListener: (
    type: "downloadprogress",
    listener: (event: { loaded: number }) => void,
  ) => void;
};

type TranslationLanguagePair = {
  sourceLanguage: string;
  targetLanguage: string;
};

type LanguageDetectorConstructor = {
  availability(): Promise<BuiltInAiAvailability>;
  create(options?: {
    monitor?: (monitor: BuiltInAiMonitor) => void;
    signal?: AbortSignal;
  }): Promise<{
    destroy?(): void;
    detect(
      text: string,
      options?: { signal?: AbortSignal },
    ): Promise<Array<{ confidence: number; detectedLanguage: string }>>;
  }>;
};

type TranslatorConstructor = {
  availability(options: TranslationLanguagePair): Promise<BuiltInAiAvailability>;
  create(options: TranslationLanguagePair & {
    monitor?: (monitor: BuiltInAiMonitor) => void;
    signal?: AbortSignal;
  }): Promise<{
    destroy?(): void;
    ready?: Promise<void>;
    translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  }>;
};

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

const operationTimeoutMs = 3 * 60 * 1000;

class ModelTimeoutError extends Error {}

function withTimeout<Result>(
  promise: Promise<Result>,
  controller: AbortController,
  message: string,
) {
  return new Promise<Result>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new ModelTimeoutError(message));
      controller.abort();
    }, operationTimeoutMs);
    promise.then(
      (result) => {
        window.clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function baseLanguage(language: string) {
  try {
    return new Intl.Locale(language).language;
  } catch {
    return language.toLowerCase().split("-")[0];
  }
}

function translationModelLanguage(language: string) {
  try {
    const locale = new Intl.Locale(language);
    if (locale.language === "zh") {
      return locale.script === "Hant" || ["HK", "MO", "TW"].includes(locale.region ?? "")
        ? "zh-Hant"
        : "zh";
    }
    return locale.language;
  } catch {
    return baseLanguage(language);
  }
}

export function createTranslation(options: {
  getTargetLanguage: () => string;
}) {
  const builtInAi = globalThis as BuiltInAiGlobals;
  let activeResource: TranslationResource | null = null;
  let activeController: AbortController | null = null;
  let pendingDownload: (() => void) | null = null;
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
    activeController?.abort();
    activeController = null;
    pendingDownload = null;
    release();
  };

  const ensureUsable = (availability: BuiltInAiAvailability, modelName: string) => {
    if (availability === "unavailable") {
      throw new Error(`${modelName} is not available in this browser.`);
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

  const detectLanguage = async (
    text: string,
    currentRunId: number,
    controller: AbortController,
  ) => {
    const { LanguageDetector } = builtInAi;
    if (!LanguageDetector) {
      throw new Error("Built-in language detection is not available in this browser.");
    }

    const availability = await LanguageDetector.availability();
    ensureUsable(availability, "The built-in language model");
    const results = await useResource(
      withTimeout(
        LanguageDetector.create({ signal: controller.signal }),
        controller,
        "Language detection took too long.",
      ),
      currentRunId,
      (detector) => withTimeout(
        detector.detect(text, { signal: controller.signal }),
        controller,
        "Language detection took too long.",
      ),
    );
    const [result] = results ?? [];
    return result?.confidence && result.confidence >= 0.45 ? result.detectedLanguage : "en";
  };

  const translate = async (
    { sourceText, x, y }: TranslationRequest,
    knownSourceLanguage?: string,
    downloadApproved = false,
  ) => {
    cancel();
    const currentRunId = runId;
    const controller = new AbortController();
    activeController = controller;
    const targetLanguage = translationModelLanguage(options.getTargetLanguage());
    const baseDetail = {
      sourceText,
      status: "loading" as const,
      targetLanguage,
      x,
      y,
    };

    emitViewerEvent(knownSourceLanguage
      ? VIEWER_EVENTS.translationUpdate
      : VIEWER_EVENTS.translationOpen, {
      ...baseDetail,
      message: "Translating...",
    });

    try {
      const { Translator } = builtInAi;
      if (!Translator) {
        throw new Error("Built-in translation is not available in this browser.");
      }

      const sourceLanguage = knownSourceLanguage
        ?? await detectLanguage(sourceText, currentRunId, controller);
      if (currentRunId !== runId) return;
      if (baseLanguage(sourceLanguage) === baseLanguage(targetLanguage)) {
        emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
          ...baseDetail,
          message: "Selected text is already in the target language.",
          sourceLanguage,
          status: "success",
          translatedText: sourceText,
        });
        return;
      }

      const languagePair = { sourceLanguage, targetLanguage };
      if (!downloadApproved) {
        const availability = await Translator.availability(languagePair);
        if (currentRunId !== runId) return;
        ensureUsable(availability, "The built-in translation model");
        if (availability !== "available") {
          pendingDownload = () => {
            void translate({ sourceText, x, y }, sourceLanguage, true);
          };
          emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
            ...baseDetail,
            message: availability === "downloading"
              ? "This language model is still downloading. Click to continue."
              : "This language direction is not installed. Click to download and translate.",
            sourceLanguage,
            status: "downloadable",
          });
          return;
        }
      }

      const translatedText = await useResource(
        withTimeout(
          Translator.create({
            ...languagePair,
            signal: controller.signal,
            monitor(monitor) {
              monitor.addEventListener("downloadprogress", (event) => {
                if (currentRunId !== runId) return;
                emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
                  ...baseDetail,
                  message: event.loaded >= 1
                    ? "Installing the built-in translation model..."
                    : "Downloading the built-in translation model...",
                  progress: event.loaded,
                  sourceLanguage,
                });
              });
            },
          }),
          controller,
          "The built-in translation model took too long to become ready.",
        ),
        currentRunId,
        async (translator) => {
          if (translator.ready) {
            await withTimeout(
              translator.ready,
              controller,
              "The built-in translation model took too long to become ready.",
            );
          }
          return withTimeout(
            translator.translate(sourceText, { signal: controller.signal }),
            controller,
            "Translation took too long.",
          );
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
      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        message: error instanceof Error ? error.message : "Translation failed.",
        status: "error",
      });
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  const stopListening = listenViewerEvent(VIEWER_EVENTS.translationClose, cancel);
  const stopDownloadListening = listenViewerEvent(VIEWER_EVENTS.translationDownload, () => {
    const download = pendingDownload;
    pendingDownload = null;
    download?.();
  });

  return {
    cancel,
    destroy: () => {
      cancel();
      stopListening();
      stopDownloadListening();
    },
    translate,
  };
}
