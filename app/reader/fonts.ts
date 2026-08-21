import { platform } from "#platform";
import { READER_LATIN_FONT_FAMILY, READER_MONO_FONT_FAMILY } from "./book-styles";
import { startupTrace } from "../shared/startup-trace";

const documentFontLoads = new WeakMap<Document, Promise<void>>();
const FONT_LOAD_TIMEOUT = 2_000;
let readerFontsReady: Promise<void> | undefined;

export function getReaderFontQueries(fontSize: number) {
  return [
    `${fontSize}px "${READER_LATIN_FONT_FAMILY}"`,
    `italic ${fontSize}px "${READER_LATIN_FONT_FAMILY}"`,
    `${fontSize}px "${READER_MONO_FONT_FAMILY}"`,
  ];
}

export function preloadReaderFonts() {
  if (readerFontsReady) return readerFontsReady;

  const profile = platform.readerProfile;
  const fontUrls = [profile.latinFontUrl, profile.latinItalicFontUrl, profile.monoFontUrl];
  startupTrace.start("reader-fonts", {
    fonts: [
      { family: READER_LATIN_FONT_FAMILY, format: profile.latinFontFormat, style: "normal", url: profile.latinFontUrl },
      { family: READER_LATIN_FONT_FAMILY, format: profile.latinItalicFontFormat, style: "italic", url: profile.latinItalicFontUrl },
      { family: READER_MONO_FONT_FAMILY, format: profile.monoFontFormat, style: "normal", url: profile.monoFontUrl },
    ],
  });
  const fontLoads = [
    new FontFace(
      READER_LATIN_FONT_FAMILY,
      `url("${profile.latinFontUrl}") format("${profile.latinFontFormat}")`,
      { style: "normal", weight: "400 800" },
    ).load(),
    new FontFace(
      READER_LATIN_FONT_FAMILY,
      `url("${profile.latinItalicFontUrl}") format("${profile.latinItalicFontFormat}")`,
      { style: "italic", weight: "400 800" },
    ).load(),
    new FontFace(
      READER_MONO_FONT_FAMILY,
      `url("${profile.monoFontUrl}") format("${profile.monoFontFormat}")`,
      { style: "normal", weight: profile.monoFontWeight },
    ).load(),
  ];

  readerFontsReady = Promise.all(fontLoads)
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
      startupTrace.complete("reader-fonts", {
        fontCount: fonts.length,
        ...startupTrace.fontResources(fontUrls),
      });
    })
    .catch((error) => {
      startupTrace.fail("reader-fonts", error);
    });
  return readerFontsReady;
}

function waitAtMost(task: Promise<unknown>, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, timeout);
    task.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function loadDocumentFonts(doc: Document, queries: string[]) {
  if (!doc.fonts) return Promise.resolve();

  let fontsReady = documentFontLoads.get(doc);
  if (!fontsReady) {
    fontsReady = waitAtMost(
      Promise.all(queries.map((query) => doc.fonts.load(query))),
      FONT_LOAD_TIMEOUT,
    )
      .then(() => undefined)
      .catch((error) => {
        console.warn("Failed to load reader document fonts.", error);
      });
    documentFontLoads.set(doc, fontsReady);
  }
  return fontsReady;
}
