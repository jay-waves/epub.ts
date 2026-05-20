import type { createHighlightController } from "./highlight-controller";
import type { createReadingProgressController } from "./components/reading-progress";
import type { createSearchController } from "./search-controller";
import type { setupViewerKeybindings } from "./viewer-keybindings";
import type { FoliateViewElement, TocItem } from "./viewer-types";

export const runtime: {
  extraUiReady: boolean;
  footnotesLabeledDocs: WeakSet<Document>;
  foliateScrollbarPatchReady: boolean;
  foliateViewReady: Promise<unknown> | null;
  highlightController: ReturnType<typeof createHighlightController> | null;
  isImageZoomOpen: boolean;
  isSearchOpen: boolean;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  postLoadTaskToken: number;
  readerFontsReady: Promise<void> | null;
  readerView: FoliateViewElement | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  savePositionTimer: number | undefined;
  searchController: ReturnType<typeof createSearchController> | null;
  tocItems: TocItem[];
} = {
  extraUiReady: false,
  footnotesLabeledDocs: new WeakSet<Document>(),
  foliateScrollbarPatchReady: false,
  foliateViewReady: null,
  highlightController: null,
  isImageZoomOpen: false,
  isSearchOpen: false,
  keybindings: null,
  postLoadTaskToken: 0,
  readerFontsReady: null,
  readerView: null,
  readingProgressController: null,
  savePositionTimer: undefined,
  searchController: null,
  tocItems: [],
};
