import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../events";
import { baseLanguage, translationModelLanguage } from "./translation-language";

type TranslationResource = Pick<Translator, "destroy">;

type TranslationRequest = {
  sourceText: string;
  x: number;
  y: number;
};

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

async function withTimeout<Result>(
  task: () => Promise<Result>,
  controller: AbortController,
  message: string,
) {
  const timeout = AbortSignal.timeout(availabilityTimeoutMs);
  const signal = AbortSignal.any([controller.signal, timeout]);
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const reject = () => aborted.reject(signal.reason);
  signal.addEventListener("abort", reject, { once: true });
  try {
    return await Promise.race([task(), aborted.promise]);
  } catch (error) {
    if (timeout.aborted) {
      throw new ModelTimeoutError(message);
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", reject);
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
  getSourceLanguage: () => string | undefined;
  getTargetLanguage: () => string;
}) {
  let activeController: AbortController | null = null;
  let pendingDownload: (() => void) | null = null;
  let cachedTranslator: {
    languagePairKey: string;
    session: Translator;
  } | null = null;
  let documentLanguage = Promise.resolve<string | undefined>(undefined);

  const release = (resource: TranslationResource | null | undefined) => {
    if (!resource) return;
    try {
      resource.destroy?.();
    } catch {
      // The browser may already have released a cancelled built-in AI session.
    }
  };

  const invalidateCachedTranslator = (session: Translator | null | undefined) => {
    if (!session || cachedTranslator?.session !== session) return;
    release(session);
    cachedTranslator = null;
  };

  const cancel = () => {
    activeController?.abort();
    activeController = null;
    pendingDownload = null;
  };

  const ensureUsable = (availability: Availability, modelName: string) => {
    if (availability === "unavailable") {
      throw new Error(`${modelName} is not available in this browser.`);
    }
  };

  const translate = async (
    { sourceText, x, y }: TranslationRequest,
    downloadApproved = false,
  ) => {
    cancel();
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
    let usedTranslator: Translator | null = null;

    emitViewerEvent(VIEWER_EVENTS.translationOpen, {
      ...baseDetail,
      message: downloadApproved
        ? "Preparing the built-in translation model..."
        : "Translating...",
    });

    try {
      if (!("Translator" in globalThis)) {
        throw new Error("Built-in translation is not available in this browser.");
      }

      const detectedLanguage = options.getSourceLanguage() ?? await documentLanguage;
      const effectiveLanguage = options.getSourceLanguage() ?? detectedLanguage;
      if (!effectiveLanguage) {
        throw new Error("The document language could not be detected.");
      }
      const sourceLanguage = translationModelLanguage(effectiveLanguage);
      controller.signal.throwIfAborted();
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
      if (cachedTranslator?.languagePairKey !== languagePairKey) {
        release(cachedTranslator?.session);
        cachedTranslator = null;
      }
      let translator = cachedTranslator?.languagePairKey === languagePairKey
        ? cachedTranslator.session
        : undefined;
      usedTranslator = translator ?? null;
      const canDownload = downloadApproved || hasDownloadConsent(languagePairKey);
      if (!translator && !canDownload) {
        const availability = await withTimeout(
          () => Translator.availability(languagePair),
          controller,
          "The browser did not report translation model availability.",
        );
        controller.signal.throwIfAborted();
        ensureUsable(availability, "The built-in translation model");
        if (availability !== "available") {
          pendingDownload = () => {
            grantDownloadConsent(languagePairKey);
            void translate({ sourceText, x, y }, true);
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
        translator = await Translator.create({
          ...languagePair,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", ({ loaded }) => {
              if (controller.signal.aborted) return;
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
        });
        if (controller.signal.aborted) {
          release(translator);
          return;
        }
        cachedTranslator = { languagePairKey, session: translator };
        usedTranslator = translator;
        grantDownloadConsent(languagePairKey);
      }

      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        message: "Translating...",
        sourceLanguage,
      });

      const translatedText = await translator.translate(sourceText, { signal: controller.signal });
      controller.signal.throwIfAborted();

      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        sourceLanguage,
        status: "success",
        translatedText,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      // Do not retain a session after a non-cancellation failure.
      invalidateCachedTranslator(usedTranslator);
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
    setSourceLanguage(language: string | undefined | Promise<string | undefined>) {
      cancel();
      documentLanguage = Promise.resolve(language);
    },
    translate,
  };
}
