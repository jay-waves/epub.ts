declare module "foliate-js/*.js";
declare module "*.css";
declare module "*?raw" {
  const content: string;
  export default content;
}

type BuiltInAiAvailability = "available" | "downloadable" | "downloading" | "unavailable";

type BuiltInAiMonitor = {
  addEventListener: (
    type: "downloadprogress",
    listener: (event: { loaded: number }) => void,
  ) => void;
};

type LanguageDetectionResult = {
  confidence: number;
  detectedLanguage: string;
};

interface LanguageDetectorInstance {
  detect(text: string): Promise<LanguageDetectionResult[]>;
}

interface LanguageDetectorConstructor {
  availability(): Promise<BuiltInAiAvailability>;
  create(options?: { monitor?: (monitor: BuiltInAiMonitor) => void }): Promise<LanguageDetectorInstance>;
}

interface TranslatorInstance {
  ready?: Promise<void>;
  translate(text: string): Promise<string>;
}

interface TranslatorConstructor {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<BuiltInAiAvailability>;
  create(options: {
    monitor?: (monitor: BuiltInAiMonitor) => void;
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<TranslatorInstance>;
}

declare global {
  var LanguageDetector: LanguageDetectorConstructor | undefined;
  var Translator: TranslatorConstructor | undefined;
}
