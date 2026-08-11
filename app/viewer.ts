import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFlow,
  applyReaderFontSize,
  applyReaderLayoutLevel,
  applyReaderLayout,
  applyReaderTheme,
  canChangeReaderFontSize,
  canChangeReaderLayoutLevel,
  changeReaderFlow,
  getBookStyles,
  getNextReaderThemeId,
  READER_FONT_SIZE_STEP,
  READER_LAYOUT_LEVEL_STEP,
} from "./reader/settings";
import {
  READER_FONT_FAMILY,
  READER_LATIN_FONT_FAMILY,
  READER_LATIN_FONT_FORMAT,
  READER_LATIN_ITALIC_FONT_FORMAT,
  READER_LATIN_ITALIC_FONT_URL,
  READER_LATIN_FONT_URL,
  READER_MONO_FONT_FAMILY,
  READER_MONO_FONT_FORMAT,
  READER_MONO_FONT_WEIGHT,
  READER_MONO_FONT_URL,
} from "./reader/book-styles";
import {
  createAnnotatedEpub,
  getEpubBlob,
  readEmbeddedHighlights,
} from "./epub/annotations";
import { createView } from "./renderer";
import { getBookKey } from "./epub/metadata";
import { createHighlights } from "./reader/highlights";
import {
  clearMathCache,
  closeContentOverlays,
  disposeContent,
  prepareContent,
} from "./reader/content";
import { createSearch } from "./reader/search";
import { createBookInfo } from "./book-info";
import { App } from "./App";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { createInteractions } from "./reader/interactions";
import {
  getSavedPosition,
  saveReaderSettings,
  saveReadingPosition,
  setSavedHighlights,
} from "./viewer-storage";
import type { ReaderHighlight, ReaderSettings, ReaderView, ReadingPosition } from "./reader/model";
import type { Location } from "./reader/navigation";
import type { DockAction } from "./viewer-events";
import { createDebouncedTask, DEFAULT_READER_SETTINGS, readerSettings } from "./reader/model";
import { createBookSession, resetBookSession } from "./viewer-session";
import { createRenderState } from "./reader/render";
import { Navigation } from "./reader/navigation";
import { Reader } from "./reader/lifecycle";
import { platform } from "#platform";
import type { PlatformDocument } from "./platform/types";
import "./viewer.css";

type ViewerRuntime = {
  criticalInteractions: AbortController | null;
  disposed: boolean;
  extraInteractionsDispose: (() => void) | null;
  isSearchOpen: boolean;
  interactions: ReturnType<typeof createInteractions> | null;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  lastScrollEdgeFeedbackAt: number;
  reader: Reader | null;
  fontsReady: Promise<void> | null;
  search: ReturnType<typeof createSearch> | null;
  scrollEdgeFeedbackTimer?: number;
};

const runtime: ViewerRuntime = {
  criticalInteractions: null,
  disposed: false,
  extraInteractionsDispose: null,
  isSearchOpen: false,
  interactions: null,
  keybindings: null,
  lastScrollEdgeFeedbackAt: 0,
  reader: null,
  fontsReady: null,
  search: null,
};

const getView = () => runtime.reader?.view ?? null;
const getNavigation = () => runtime.reader?.navigation ?? null;

const appRoot = queryRequired<HTMLElement>("#app");

function goToProgress(progress: number) {
  const navigation = getNavigation();
  if (!navigation || isReaderRenderPending()) return;
  void renderState.run(() => navigation.go({ fraction: progress })).catch((error) => {
    console.warn("Failed to navigate to reading progress.", error);
  });
}

const reactRoot = createRoot(appRoot);
flushSync(() => {
  reactRoot.render(createElement(App, {
    onOpenLocalFile: platform.openLocalDocument ? (file) => {
      void openBook(platform.openLocalDocument!(file));
    } : undefined,
    onPickLocalFile: platform.pickLocalDocument ? async () => {
      const selectedDocument = await platform.pickLocalDocument!();
      if (selectedDocument) void openBook(selectedDocument);
    } : undefined,
  }));
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");
const initialDocumentTitle = document.title;
const session = createBookSession();
const readerLayoutTarget = {
  root: readerRoot,
  get view() { return getView(); },
};
const renderState = createRenderState({
  root: readerRoot,
});
runtime.interactions = createInteractions({
  getFlow: () => readerSettings.flow,
  navigate: async (href) => {
    const navigation = getNavigation();
    return navigation ? renderState.run(() => navigation.go(href)) : undefined;
  },
  openExternal: platform.openExternal,
  root: readerRoot,
  turn: (direction) => ensureKeybindings().turnPage(direction),
});

function getFontQueries() {
  return [
    `${readerSettings.fontSize}px "${READER_FONT_FAMILY}"`,
    `${readerSettings.fontSize}px "${READER_LATIN_FONT_FAMILY}"`,
    `italic ${readerSettings.fontSize}px "${READER_LATIN_FONT_FAMILY}"`,
    `${readerSettings.fontSize}px "${READER_MONO_FONT_FAMILY}"`,
  ];
}

function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

function setHasUnsavedChanges(dirty: boolean) {
  session.dirty = dirty;
  renderDocumentTitle();
  emitDockUpdate();
}

function renderDocumentTitle() {
  document.title = `${session.dirty ? "*" : ""}${session.document?.name ?? initialDocumentTitle}`;
}

const SCROLL_EDGE_FEEDBACK_COOLDOWN_MS = 900;

const highlightState = createHighlights({
  getBookKey: () => session.bookKey,
  getNavigation,
  getProgress: () => session.progress,
  getView,
  openExternal: platform.openExternal,
  translationModelPolicy: platform.translationModelPolicy,
});

function ensureKeybindings() {
  runtime.keybindings ??= setupViewerKeybindings({
    getView,
    getNavigation,
    getFlow: () => readerSettings.flow,
    canTurnPage: () => !isReaderRenderPending() && !document.body.classList.contains("reader-image-zoom-open"),
    beforeSectionTurn: handleBeforeSectionTurn,
    afterSectionTurn: handleAfterSectionTurn,
    onScrollEdge: showScrollEdgeFeedback,
    openSearch,
    closeSearch: clearSearchState,
    saveBook: () => { void saveAnnotatedBook(); },
  });
  const view = getView();
  if (view) runtime.keybindings.bindReaderView(view);
  return runtime.keybindings;
}

function emitTocUpdate() {
  emitViewerEvent(VIEWER_EVENTS.tocUpdate, {
    currentHref: session.href,
    items: session.tocItems,
  });
}

function emitBookInfoUpdate() {
  const { sourceLabel = "", sourceUrl = "" } = session.document ?? {};
  emitViewerEvent(
    VIEWER_EVENTS.bookInfoUpdate,
    createBookInfo({
      book: getView()?.book,
      sourceLabel,
      sourceUrl,
    }),
  );
}

function preloadFonts() {
  if (runtime.fontsReady) return runtime.fontsReady;

  const fontLoads = [
    new FontFace(READER_LATIN_FONT_FAMILY, `url("${READER_LATIN_FONT_URL}") format("${READER_LATIN_FONT_FORMAT}")`, {
      style: "normal",
      weight: "400 800",
    }).load(),
    new FontFace(
      READER_LATIN_FONT_FAMILY,
      `url("${READER_LATIN_ITALIC_FONT_URL}") format("${READER_LATIN_ITALIC_FONT_FORMAT}")`,
      {
        style: "italic",
        weight: "400 800",
      },
    ).load(),
    new FontFace(READER_MONO_FONT_FAMILY, `url("${READER_MONO_FONT_URL}") format("${READER_MONO_FONT_FORMAT}")`, {
      style: "normal",
      weight: READER_MONO_FONT_WEIGHT,
    }).load(),
  ];

  runtime.fontsReady = Promise.all(fontLoads)
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
    })
    .catch((error) => {
      console.warn("Failed to preload reader fonts.", error);
    });

  return runtime.fontsReady;
}

function getCurrentScrolledSectionAnchor() {
  if (readerSettings.flow !== "scrolled") return null;

  const renderer = getView()?.renderer;
  const { start, viewSize } = renderer ?? {};
  if (typeof start !== "number" || typeof viewSize !== "number" || viewSize <= 0) return null;

  return Math.min(1, Math.max(0, start / viewSize));
}

function saveCurrentScrolledSectionProgress() {
  if (session.scrolledSectionIndex == null) return;

  const anchor = getCurrentScrolledSectionAnchor();
  if (anchor == null) return;

  session.scrolledSectionProgress.set(session.scrolledSectionIndex, anchor);
}

function handleBeforeSectionTurn() {
  saveCurrentScrolledSectionProgress();
  session.restoreScrollPending = readerSettings.flow === "scrolled";
  renderState.begin();
}

function handleAfterSectionTurn() {
  void renderState.revealAfterPaint();
}

function restoreScrolledSectionProgress(sectionIndex: number | undefined) {
  if (!session.restoreScrollPending || readerSettings.flow !== "scrolled" || typeof sectionIndex !== "number") {
    session.restoreScrollPending = false;
    return;
  }

  const anchor = session.scrolledSectionProgress.get(sectionIndex);
  session.restoreScrollPending = false;
  if (typeof anchor !== "number") return;

  requestAnimationFrame(() => {
    if (readerSettings.flow !== "scrolled" || session.scrolledSectionIndex !== sectionIndex) return;

    void getNavigation()?.scrollTo(anchor)?.catch((error) => {
      console.warn("Failed to restore section reading progress.", error);
    });
  });
}

const savePositionTask = createDebouncedTask((detail: Location) => {
  if (session.bookKey) {
    return saveReadingPosition(session.bookKey, detail);
  }
}, 350);

function queuePositionSave(detail: Location) {
  if (!session.bookKey || session.restoring) return;
  savePositionTask.schedule(detail);
}

function wireReaderEvents(reader: Reader) {
  const { signal, view } = reader;
  const listenerOptions = { signal };

  view.addEventListener("load", () => {
    if (!signal.aborted) {
      void renderState.revealAfterPaint();
      highlightState.bindContextTargets();
    }
  }, listenerOptions);
  view.addEventListener("unload", (event) => {
    highlightState.unbindContextDocument(event.detail.doc);
  }, listenerOptions);
  view.addEventListener("relocate", (event) => {
    const detail = reader.navigation?.location(event.detail);
    if (!detail) return;
    const sectionIndex = detail.index;

    const currentHref = detail.tocItem?.href ?? "";
    if (currentHref !== session.href) {
      session.href = currentHref;
      emitTocUpdate();
    }
    session.progress = detail.fraction ?? session.progress;
    emitViewerEvent(VIEWER_EVENTS.progressUpdate, {
      fraction: session.progress,
      index: sectionIndex,
    });
    queuePositionSave(detail);
    const previousSectionIndex = session.scrolledSectionIndex;
    session.scrolledSectionIndex = typeof sectionIndex === "number" ? sectionIndex : null;
    if (sectionIndex !== previousSectionIndex) restoreScrolledSectionProgress(sectionIndex);
  }, listenerOptions);

  view.addEventListener("create-overlay", (event) => {
    const { index } = event.detail;
    highlightState.addCurrentHighlightsToOverlay(view, index);
  }, listenerOptions);

  view.addEventListener("draw-annotation", (event) => {
    highlightState.drawAnnotation(event.detail);
  }, listenerOptions);

  view.addEventListener("show-annotation", (event) => {
    highlightState.openFromAnnotation(event.detail);
  }, listenerOptions);
}

function emitDockUpdate() {
  const isPaginated = readerSettings.flow === "paginated";

  emitViewerEvent(VIEWER_EVENTS.dockUpdate, {
    canSearch: Boolean(runtime.reader?.book),
    flowActive: !isPaginated,
    flowLabel: isPaginated ? "Switch to scrolling" : "Switch to paginated",
    hasUnsavedChanges: session.dirty,
    searchActive: runtime.isSearchOpen,
  });
}

async function saveAnnotatedBook() {
  const { bookKey, document } = session;
  if (!session.dirty || !bookKey || !document) return;

  try {
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    await highlightState.flushPendingWrites();

    // Browser file pickers need the live Ctrl+S/click activation, so acquire
    // the platform writer before reading annotations or serializing an EPUB.
    const target = await document.fileHandle.prepareWrite();
    if (!target) return;

    const highlights = highlightState.getAll();
    if ("saveAnnotations" in target) {
      if (await target.saveAnnotations(highlights)) setHasUnsavedChanges(false);
      return;
    }

    const sourceBlob = await getEpubBlob(document.sourceUrl);
    const blob = await createAnnotatedEpub(sourceBlob, highlights);
    if (blob.size === 0) throw new Error("Generated EPUB is empty.");
    if (await target.save(blob)) setHasUnsavedChanges(false);
  } catch (error) {
    if ((error as DOMException).name === "AbortError") return;
    console.warn("Failed to save annotated EPUB.", error);
  }
}

function clearSearchState() {
  if (!runtime.isSearchOpen) return false;
  runtime.isSearchOpen = false;
  runtime.search?.clear();
  emitDockUpdate();
  return true;
}

function saveCurrentReaderSettings() {
  if (session.bookKey) {
    void saveReaderSettings(session.bookKey, { ...readerSettings }).catch((error) => {
      console.warn("Failed to save reader settings.", error);
    });
  }
}

function openSearch() {
  if (!runtime.search) return false;
  runtime.isSearchOpen = true;
  runtime.search.open();
  emitDockUpdate();
  return true;
}

function toggleSearch() {
  if (runtime.isSearchOpen) {
    clearSearchState();
    return;
  }

  openSearch();
}

async function resetBookState(source: Parameters<typeof resetBookSession>[1]) {
  await savePositionTask.flush();
  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightState.flushPendingWrites();

  const reader = runtime.reader;
  runtime.reader = null;
  runtime.isSearchOpen = false;
  runtime.search?.dispose();
  runtime.search = null;
  if (reader) {
    runtime.keybindings?.unbindReaderView(reader.view);
    runtime.interactions?.unbindView(reader.view);
  }
  highlightState.reset();
  await closeContentOverlays();
  await reader?.dispose();
  await clearMathCache();
  resetBookSession(session, source);
  emitDockUpdate();
  renderDocumentTitle();
  emitTocUpdate();
  emitBookInfoUpdate();
  emitViewerEvent(VIEWER_EVENTS.progressUpdate, { fraction: 0, reset: true });
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...DEFAULT_READER_SETTINGS, ...settings };
  const flow = getView()?.isFixedLayout ? "paginated" : nextSettings.flow;

  applyReaderTheme(nextSettings.theme);
  applyReaderFlow(flow, { root: readerRoot, view: null });
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(nextSettings.layoutLevel, readerLayoutTarget);
  emitDockUpdate();
}

async function mountView() {
  const view = await createView<ReaderHighlight>();
  view.enhanceRenderedDocument = (doc, _index, signal) =>
    enhanceContent(doc, !view.isFixedLayout, signal);
  readerRoot.replaceChildren(view);
  runtime.interactions?.bindView(view);
  runtime.keybindings?.bindReaderView(view);
  return view;
}

async function enhanceContent(
  doc: Document,
  reflowable: boolean,
  signal: AbortSignal,
) {
  try {
    await prepareContent(doc, {
      fontQueries: getFontQueries(),
      reflowable,
      signal,
    });
  } catch (error) {
    console.warn("Failed to enhance reader content.", error);
  }
}

function isReaderRenderPending() {
  return renderState.isPending();
}

function showScrollEdgeFeedback(direction: number) {
  const now = performance.now();
  if (now - runtime.lastScrollEdgeFeedbackAt < SCROLL_EDGE_FEEDBACK_COOLDOWN_MS) return;
  runtime.lastScrollEdgeFeedbackAt = now;

  const edgeClass = direction < 0 ? "reader-frame--edge-top" : "reader-frame--edge-bottom";
  readerRoot.classList.remove("reader-frame--edge-top", "reader-frame--edge-bottom");
  void readerRoot.offsetWidth;
  readerRoot.classList.add(edgeClass);

  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = window.setTimeout(() => {
    readerRoot.classList.remove(edgeClass);
    runtime.scrollEdgeFeedbackTimer = undefined;
  }, 360);
}

async function restoreSavedPosition(navigation: Navigation, savedPosition?: ReadingPosition) {
  session.restoring = true;
  try {
    const attempts: Array<Parameters<Navigation["init"]>[0]> = [];
    if (savedPosition?.cfi) attempts.push({ lastLocation: savedPosition.cfi });
    if (typeof savedPosition?.fraction === "number") {
      attempts.push({ lastLocation: { fraction: savedPosition.fraction } });
    }
    attempts.push({ showTextStart: true });

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await navigation.init(attempt);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
  } finally {
    session.restoring = false;
  }
}

let openBookTask = Promise.resolve();

function openBook(platformDocument: PlatformDocument) {
  const task = openBookTask.then(() => replaceBook(platformDocument));
  openBookTask = task.catch(() => undefined);
  return task;
}

async function replaceBook(platformDocument: PlatformDocument) {
  if (runtime.disposed) {
    platformDocument.release?.();
    return;
  }

  let reader: Reader | null = null;
  let view: ReaderView | null = null;
  try {
    await resetBookState({
      bookKey: platformDocument.key,
      document: platformDocument,
    });
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");

    view = await mountView();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    renderState.begin();
    await preloadFonts();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    reader = await Reader.open(platformDocument, view, (openingReader) => {
      reader = openingReader;
      runtime.reader = openingReader;
      wireReaderEvents(openingReader);
    });
    reader.signal.throwIfAborted();
    const { navigation } = reader;
    emitViewerEvent(VIEWER_EVENTS.documentOpen);
    session.bookKey = await getBookKey(view.book, platformDocument.key);
    reader.signal.throwIfAborted();
    const bookKey = session.bookKey;
    runtime.search = createSearch({
      book: reader.book,
      bookKey,
      navigation,
      run: renderState.run,
      signal: reader.signal,
      view,
    });
    const savedPosition = await getSavedPosition(bookKey);
    reader.signal.throwIfAborted();
    applyReaderSettings(savedPosition?.settings);

    emitBookInfoUpdate();
    session.tocItems = view.book?.toc ?? [];
    emitTocUpdate();
    await restoreHighlights(reader, bookKey);
    reader.signal.throwIfAborted();
    await restoreSavedPosition(navigation, savedPosition);
    reader.signal.throwIfAborted();
    await renderState.revealAfterPaint();
    reader.signal.throwIfAborted();
  } catch (error) {
    renderState.end();
    runtime.search?.dispose();
    runtime.search = null;
    if (runtime.reader === reader) runtime.reader = null;
    if (reader) {
      runtime.keybindings?.unbindReaderView(reader.view);
      runtime.interactions?.unbindView(reader.view);
      await reader.dispose();
    } else {
      if (view) {
        runtime.keybindings?.unbindReaderView(view);
        runtime.interactions?.unbindView(view);
        view.destroy();
      }
      platformDocument.release?.();
    }
    if ((error as DOMException).name !== "AbortError") {
      console.error(`Failed to open ${platformDocument.sourceLabel}`, error);
    }
    if (session.document === platformDocument) {
      session.document = null;
      session.bookKey = "";
      renderDocumentTitle();
      emitDockUpdate();
    }
  }
}

function setupCriticalInteractions() {
  runtime.criticalInteractions?.abort();
  const interactions = new AbortController();
  runtime.criticalInteractions = interactions;
  const { signal } = interactions;
  window.addEventListener("resize", () => {
    applyReaderLayout(readerLayoutTarget);
    highlightState.close();
  }, { signal });

}

function setupExtraInteractions() {
  const disposers = [
    listenViewerEvent(VIEWER_EVENTS.tocNavigate, (href) => {
      if (!href || isReaderRenderPending()) return;
      void renderState.run(() => getNavigation()?.go(href)).catch((error) => {
        console.warn("Failed to open table-of-contents entry.", error);
      });
    }),
    listenViewerEvent(VIEWER_EVENTS.progressSeek, goToProgress),
    listenViewerEvent(VIEWER_EVENTS.searchCollect, ({ highlightedOnly, query }) => {
      void runtime.search?.collect(query, highlightedOnly);
    }),
    listenViewerEvent(VIEWER_EVENTS.searchPrevious, () => {
      void runtime.search?.previous();
    }),
    listenViewerEvent(VIEWER_EVENTS.searchNext, () => {
      void runtime.search?.next();
    }),
    listenViewerEvent(VIEWER_EVENTS.searchClear, clearSearchState),
    listenViewerEvent(VIEWER_EVENTS.highlightContextAction, (action) => {
      highlightState.handleContextAction(action);
    }),
    listenViewerEvent(VIEWER_EVENTS.unsavedChange, () => setHasUnsavedChanges(true)),
    listenViewerEvent(VIEWER_EVENTS.dockAction, (action) => {
      void handleDockAction(action).catch((error) => {
        console.warn("Failed to apply reader action.", error);
      });
    }),
  ];

  return () => disposers.forEach((dispose) => dispose());
}

async function runReaderStyleChange(action: () => void) {
  if (isReaderRenderPending()) return;

  await renderState.run(async () => {
    await preloadFonts();
    action();
  });
}

async function handleDockAction(action: DockAction) {
  switch (action) {
    case "open-info":
      emitBookInfoUpdate();
      emitViewerEvent(VIEWER_EVENTS.bookInfoOpen);
      return;
    case "open-toc":
      emitTocUpdate();
      emitViewerEvent(VIEWER_EVENTS.tocOpen);
      return;
    case "toggle-search":
      toggleSearch();
      return;
    case "save-book":
      await saveAnnotatedBook();
      return;
    case "toggle-flow":
      await runReaderStyleChange(() => {
        changeReaderFlow(readerLayoutTarget);
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "toggle-theme":
      await runReaderStyleChange(() => {
        applyReaderTheme(getNextReaderThemeId());
        getView()?.renderer?.setStyles?.(getBookStyles());
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "decrease-font":
    case "increase-font": {
      const delta = action === "decrease-font" ? -READER_FONT_SIZE_STEP : READER_FONT_SIZE_STEP;
      if (!canChangeReaderFontSize(delta)) return;
      await runReaderStyleChange(() => {
        applyReaderFontSize(readerSettings.fontSize + delta, getView());
      });
      saveCurrentReaderSettings();
      return;
    }
    case "decrease-width":
    case "increase-width": {
      const delta = action === "decrease-width" ? -READER_LAYOUT_LEVEL_STEP : READER_LAYOUT_LEVEL_STEP;
      if (!canChangeReaderLayoutLevel(delta)) return;
      await runReaderStyleChange(() => {
        applyReaderLayoutLevel(
          readerSettings.layoutLevel + delta,
          readerLayoutTarget,
        );
      });
      saveCurrentReaderSettings();
    }
  }
}

async function restoreHighlights(reader: Reader, bookKey: string) {
  const { book, signal, view } = reader;
  if (signal.aborted) return;

  try {
    const highlights = await readEmbeddedHighlights(book);
    if (signal.aborted) return;
    if (highlights) await setSavedHighlights(bookKey, highlights);
  } catch (error) {
    console.warn("Failed to read embedded EPUB highlights.", error);
  }
  if (signal.aborted) return;
  try {
    await highlightState.restore(view, bookKey);
  } catch (error) {
    console.warn("Failed to restore saved highlights.", error);
  }
}

async function bootstrap() {
  applyReaderSettings(undefined);
  setupCriticalInteractions();
  ensureKeybindings();
  runtime.extraInteractionsDispose = setupExtraInteractions();
  try {
    const initialDocument = await platform.loadInitialDocument();
    if (initialDocument) {
      if (runtime.disposed) {
        initialDocument.release?.();
        return;
      }
      void openBook(initialDocument);
      return;
    }
  } catch (error) {
    console.error("Failed to load the initial EPUB document.", error);
  }

}

async function disposeViewer() {
  if (runtime.disposed) return;
  runtime.disposed = true;
  const reader = runtime.reader;
  runtime.reader = null;
  await savePositionTask.flush();
  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = undefined;

  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightState.flushPendingWrites();

  runtime.criticalInteractions?.abort();
  runtime.extraInteractionsDispose?.();
  runtime.keybindings?.destroy();
  runtime.interactions?.destroy();
  highlightState.destroy();
  runtime.search?.dispose();
  runtime.search = null;
  await disposeContent();
  await reader?.dispose();
  await clearMathCache();
  session.document = null;

  reactRoot.unmount();
  window.removeEventListener("pagehide", handlePageHide);
}

function handlePageHide(event: PageTransitionEvent) {
  if (!event.persisted) {
    void disposeViewer().catch((error) => console.warn("Failed to dispose viewer cleanly.", error));
  }
}

window.addEventListener("pagehide", handlePageHide);
void bootstrap().catch((error) => console.error("Failed to start viewer.", error));
