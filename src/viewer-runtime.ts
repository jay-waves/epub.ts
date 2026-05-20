import type { createHighlightController } from "./highlight-controller";
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
  readerFontsReady: Promise<void> | null;
  readerView: FoliateViewElement | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  savePositionTimer: number | undefined;
  searchController: ReturnType<typeof createSearchController> | null;
  tocItems: TocItem[];
} = {
  extraUiReady: false,
  foliateScrollbarPatchReady: false,
  foliateViewReady: null,
  highlightController: null,
  isSearchOpen: false,
  keybindings: null,
  readerFontsReady: null,
  readerView: null,
  readingProgressController: null,
  savePositionTimer: undefined,
  searchController: null,
  tocItems: [],
};
