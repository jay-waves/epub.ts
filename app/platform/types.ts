import type { ReaderHighlight } from "../reader";

export interface EpubFileWriter {
  save?(blob: Blob): Promise<boolean>;
  saveAnnotations?(highlights: readonly ReaderHighlight[]): Promise<boolean>;
}

/**
 * Cross-platform reference to the EPUB currently being edited.
 *
 * Browser platforms back this with a persisted FileSystemFileHandle (acquired
 * lazily when necessary), while epub.ts backs it with the daemon document
 * capability. This mirrors PDF.ts's PdfFileHandle contract.
 */
export interface EpubFileHandle {
  readonly name?: string;
  prepareWrite(): Promise<EpubFileWriter | null>;
}

export interface PlatformDocument {
  readonly input: File | string;
  readonly sourceUrl: string;
  readonly key: string;
  readonly name: string;
  readonly sourceLabel: string;
  readonly fileHandle: EpubFileHandle;
  release?(): void;
}

export interface ReaderProfile {
  readonly defaultFontSize: number;
  readonly fontFamily: string;
  readonly fontLocalName?: string;
  readonly fontUrl?: string;
  readonly fontFormat: string;
  readonly latinFontUrl: string;
  readonly latinFontFormat: string;
  readonly latinItalicFontUrl?: string;
  readonly latinItalicFontFormat?: string;
  readonly monoFontUrl: string;
  readonly monoFontFormat: string;
  readonly monoFontWeight: string;
  readonly fontSizeAdjust: string;
  readonly lineHeightOffset: number;
}

export interface ViewerPlatform {
  readonly readerProfile: ReaderProfile;
  readonly translationModelPolicy: "allow-download" | "external-fallback";
  loadInitialDocument(): Promise<PlatformDocument | undefined>;
  openLocalDocument?(file: File): PlatformDocument;
  pickLocalDocument?(): Promise<PlatformDocument | undefined>;
  openExternal(url: string): void;
  readViewerMetadata<Value>(key: string): Promise<Value | undefined>;
  writeViewerMetadata<Value>(key: string, value: Value): Promise<void>;
}
