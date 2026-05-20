import type { createHighlightController } from "./highlight-controller";
import type { createReaderDocumentCache } from "./reader-document-cache";
import type { createReadingProgressController } from "./components/reading-progress";
import type { createSearchController } from "./search-controller";
import type { setupViewerKeybindings } from "./viewer-keybindings";
import type { FoliateViewElement, TocItem } from "./viewer-types";

export const runtime: {
  extraUiReady: boolean;
  foliateScrollbarPatchReady: boolean;
  foliateViewReady: Promise<unknown> | null;
  highlightController: ReturnType<typeof createHighlightController> | null;
  isSearchOpen: boolean;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  postLoadTaskToken: number;
  readerFontsReady: Promise<void> | null;
  readerDocumentCache: ReturnType<typeof createReaderDocumentCache> | null;
  readerView: FoliateViewElement | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  searchController: ReturnType<typeof createSearchController> | null;
  tocItems: TocItem[];
  tocSectionHrefs: string[];
} = {
  extraUiReady: false,
  foliateScrollbarPatchReady: false,
  foliateViewReady: null,
  highlightController: null,
  isSearchOpen: false,
  keybindings: null,
  postLoadTaskToken: 0,
  readerFontsReady: null,
  readerDocumentCache: null,
  readerView: null,
  readingProgressController: null,
  searchController: null,
  tocItems: [],
  tocSectionHrefs: [],
};
