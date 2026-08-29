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
  }): Promise<TranslatorSession>;
};

type TranslationResource = {
  destroy?: () => void;
};

type TranslatorSession = TranslationResource & {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
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

const operationTimeoutMs = 60 * 1000;
const availabilityTimeoutMs = 5 * 1000;
const downloadConsentStorageKey = "epub.ts:translation-download-consent";

class ModelTimeoutError extends Error {}

function hasDownloadConsent(languagePairKey: string) {
  try {
    const entries = JSON.parse(localStorage.getItem(downloadConsentStorageKey) ?? "[]") as unknown;
    return Array.isArray(entries) && entries.includes(languagePairKey);
  } catch {
    return false;
  }
}

function grantDownloadConsent(languagePairKey: string) {
  try {
    const entries = JSON.parse(localStorage.getItem(downloadConsentStorageKey) ?? "[]") as unknown;
    const approved = new Set(Array.isArray(entries)
      ? entries.filter((entry): entry is string => typeof entry === "string")
      : []);
    approved.add(languagePairKey);
    localStorage.setItem(downloadConsentStorageKey, JSON.stringify([...approved]));
  } catch (error) {
    console.warn("Could not save translation model consent.", error);
  }
}

function withTimeout<Result>(
  promise: Promise<Result>,
  controller: AbortController,
  message: string,
  timeoutMs = operationTimeoutMs,
) {
  return new Promise<Result>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new ModelTimeoutError(message));
      controller.abort();
    }, timeoutMs);
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
        : "zh-Hans";
    }
    return locale.baseName;
  } catch {
    return baseLanguage(language);
  }
}

function isSameTranslationLanguage(sourceLanguage: string, targetLanguage: string) {
  if (sourceLanguage === targetLanguage) return true;
  try {
    const source = new Intl.Locale(sourceLanguage).maximize();
    const target = new Intl.Locale(targetLanguage).maximize();
    return source.language === target.language && source.script === target.script;
  } catch {
    return baseLanguage(sourceLanguage) === baseLanguage(targetLanguage);
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
  let cachedTranslator: {
    languagePairKey: string;
    session: TranslatorSession;
  } | null = null;

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

    const availability = await withTimeout(
      LanguageDetector.availability(),
      controller,
      "The browser did not report language detection availability.",
      availabilityTimeoutMs,
    );
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
    if (!result || result.detectedLanguage === "und" || result.confidence < 0.45) {
      throw new Error(
        "The source language could not be detected. This EPUB should provide a valid lang attribute.",
      );
    }
    return result.detectedLanguage;
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
      message: downloadApproved
        ? "Preparing the built-in translation model..."
        : "Translating...",
    });

    try {
      const { Translator } = builtInAi;
      if (!Translator) {
        throw new Error("Built-in translation is not available in this browser.");
      }

      const sourceLanguage = translationModelLanguage(knownSourceLanguage
        ?? await detectLanguage(sourceText, currentRunId, controller));
      if (currentRunId !== runId) return;
      if (isSameTranslationLanguage(sourceLanguage, targetLanguage)) {
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
      const languagePairKey = `${sourceLanguage}\u0000${targetLanguage}`;
      let translator = cachedTranslator?.languagePairKey === languagePairKey
        ? cachedTranslator.session
        : undefined;
      const canDownload = downloadApproved || hasDownloadConsent(languagePairKey);
      if (!translator && !canDownload) {
        const availability = await withTimeout(
          Translator.availability(languagePair),
          controller,
          "The browser did not report translation model availability.",
          availabilityTimeoutMs,
        );
        if (currentRunId !== runId) return;
        ensureUsable(availability, "The built-in translation model");
        if (availability !== "available") {
          pendingDownload = () => {
            grantDownloadConsent(languagePairKey);
            void translate({ sourceText, x, y }, sourceLanguage, true);
          };
          emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
            ...baseDetail,
            message: availability === "downloading"
              ? "This language model is still downloading. Click to continue."
              : "This language direction is not ready for this site. Click to prepare and translate.",
            sourceLanguage,
            status: "downloadable",
          });
          return;
        }
      }

      if (!translator) {
        emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
          ...baseDetail,
          message: "Preparing the built-in translation model...",
          sourceLanguage,
        });
        translator = await withTimeout(
          Translator.create({
            ...languagePair,
            signal: controller.signal,
            monitor(monitor) {
              monitor.addEventListener("downloadprogress", ({ loaded }) => {
                if (currentRunId !== runId) return;
                emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
                  ...baseDetail,
                  message: loaded >= 1
                    ? "Preparing the built-in translation model..."
                    : "Downloading the built-in translation model...",
                  progress: Math.max(0, Math.min(1, loaded)),
                  sourceLanguage,
                });
              });
            },
          }),
          controller,
          "The built-in translation model took too long to become ready.",
        );
        if (currentRunId !== runId) {
          release(translator);
          return;
        }
        release(cachedTranslator?.session);
        cachedTranslator = { languagePairKey, session: translator };
        grantDownloadConsent(languagePairKey);
      }

      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        message: "Translating...",
        sourceLanguage,
      });

      const translatedText = await withTimeout(
        translator.translate(sourceText, { signal: controller.signal }),
        controller,
        "Translation took too long.",
      );
      if (currentRunId !== runId) return;

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
      release(cachedTranslator?.session);
      cachedTranslator = null;
      stopListening();
      stopDownloadListening();
    },
    translate,
  };
}
