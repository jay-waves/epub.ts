import type { FoliateViewElement, SearchHit } from "./foliate";
import { emitViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { normalizeInlineText } from "./reader";
import { getSavedHighlights } from "./viewer-storage";
import type { Navigation } from "./reader/navigation";

const LONG_SEARCH_QUERY_THRESHOLD = 24;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 200;
const SECTION_DISTANCE_WEIGHT = 1_000_000;

type SearchControllerOptions = {
  getBookKey: () => string;
  getNavigation: () => Navigation | null;
  getReaderView: () => FoliateViewElement | null;
  runWithReaderRenderPending: (action: () => Promise<unknown> | undefined) => Promise<void>;
};

type SearchCollectOptions = {
  highlightedOnly?: boolean;
};

export function createSearchController(options: SearchControllerOptions) {
  let searchRunId = 0;
  let searchHits: SearchHit[] = [];
  let searchHitIndex = -1;

  const updateNav = (visible = searchHits.length > 0) => {
    emitViewerEvent(VIEWER_EVENTS.searchUpdate, {
      hitCount: searchHits.length,
      hitIndex: searchHitIndex,
      placeholder: "Search text",
      visible,
    });
  };

  const resetResults = (visible: boolean) => {
    const runId = ++searchRunId;
    options.getReaderView()?.clearSearch?.();
    searchHits = [];
    searchHitIndex = -1;
    updateNav(visible);
    return runId;
  };

  const showEmptyResults = (placeholder: string) => {
    emitViewerEvent(VIEWER_EVENTS.searchUpdate, {
      hitCount: 0,
      hitIndex: -1,
      placeholder,
      visible: true,
    });
  };

  const showHit = async (index: number) => {
    const readerView = options.getReaderView();
    if (!readerView || !searchHits.length) return;

    searchHitIndex = (index + searchHits.length) % searchHits.length;
    updateNav();

    const hit = searchHits[searchHitIndex];
    if (!hit) return;

    try {
      const navigate = () => options.getNavigation()?.select(hit.cfi);
      await options.runWithReaderRenderPending(navigate);
    } catch (error) {
      console.warn("Failed to navigate to search hit.", error);
    }
  };

  const showClosestHit = () => {
    const readerView = options.getReaderView();
    const [{ doc, index: currentSection } = {}] = readerView?.renderer.getContents?.() ?? [];
    if (!readerView || !doc || currentSection == null) return showHit(0);

    const view = doc.defaultView;
    const vertical = readerView.renderer.getAttribute("flow") === "scrolled";
    const viewportEnd = vertical ? view?.innerHeight : view?.innerWidth;
    if (!view || !viewportEnd) return showHit(0);

    let closestIndex = 0;
    let closestDistance = Infinity;
    for (const [index, hit] of searchHits.entries()) {
      const resolved = options.getNavigation()?.resolve(hit.cfi);
      if (!resolved) continue;

      let distance = Math.abs(resolved.index - currentSection) * SECTION_DISTANCE_WEIGHT;
      if (resolved.index === currentSection && typeof resolved.anchor === "function") {
        const anchor = resolved.anchor(doc);
        const rects = anchor instanceof view.Range || anchor instanceof view.Node
          ? getAnchorRects(anchor, view)
          : [];
        if (!rects.length) continue;
        distance = Math.min(...rects.map((rect) => {
          const start = vertical ? rect.top : rect.left;
          const end = vertical ? rect.bottom : rect.right;
          return end < 0 ? -end : start > viewportEnd ? start - viewportEnd : 0;
        }));
      }

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    return showHit(closestIndex);
  };

  const collectHighlights = async (query: string) => {
    const bookKey = options.getBookKey();
    if (!bookKey) return;

    const searchOptions = getSearchOptions(query);
    const runId = resetResults(true);

    const normalizedQuery = normalizeForHighlightSearch(searchOptions.query);
    const highlights = await getSavedHighlights(bookKey);
    if (runId !== searchRunId) return;

    searchHits = highlights
      .filter((highlight) => {
        const text = getHighlightSearchText(highlight);
        return !normalizedQuery || normalizeForHighlightSearch(text).includes(normalizedQuery);
      })
      .slice(0, MAX_SEARCH_RESULTS)
      .map((highlight) => ({
        cfi: highlight.value,
        excerpt: highlight.text,
      }));

    if (searchHits.length) {
      await showClosestHit();
    } else {
      showEmptyResults(searchOptions.query ? `No highlights for: ${searchOptions.query}` : "No highlights saved");
    }
  };

  const collect = async (query: string, collectOptions: SearchCollectOptions = {}) => {
    if (collectOptions.highlightedOnly) {
      await collectHighlights(query);
      return;
    }

    const readerView = options.getReaderView();
    if (!readerView?.search) return;

    const searchOptions = getSearchOptions(query);
    const runId = resetResults(true);

    if (!searchOptions.query) return;

    try {
      searchBook:
      for await (const entry of readerView.search(searchOptions)) {
        if (runId !== searchRunId) return;
        if (entry === "done") break;

        for (const hit of getSearchEntryHits(entry)) {
          searchHits.push({ cfi: hit.cfi, excerpt: hit.excerpt });
          if (searchHits.length >= MAX_SEARCH_RESULTS) break searchBook;
        }
      }

      if (runId !== searchRunId) return;
      if (searchHits.length) {
        await showClosestHit();
      } else {
        showEmptyResults(`No results for: ${searchOptions.query}`);
      }
    } catch (error) {
      if (runId !== searchRunId) return;
      console.error("Search failed.", error);
      updateNav();
    }
  };

  return {
    clear: () => { resetResults(false); },
    collect,
    showNext: () => showHit(searchHitIndex + 1),
    showPrevious: () => showHit(searchHitIndex - 1),
  };
}

function getAnchorRects(anchor: Node | Range, view: Window & typeof globalThis) {
  if (anchor instanceof view.Range) return Array.from(anchor.getClientRects());
  if (anchor instanceof view.Element) return [anchor.getBoundingClientRect()];
  return [];
}

function getSearchEntryHits(entry: unknown): SearchHit[] {
  if (!entry || typeof entry !== "object") return [];
  if ("subitems" in entry && Array.isArray(entry.subitems)) return entry.subitems as SearchHit[];
  if ("cfi" in entry && typeof entry.cfi === "string") return [entry as SearchHit];
  return [];
}

function getSearchOptions(query: string) {
  const normalizedQuery = normalizeInlineText(query);
  const queryPrefix = normalizedQuery.slice(0, MAX_SEARCH_QUERY_LENGTH).trim();
  const useFastExactSearch = queryPrefix.length >= LONG_SEARCH_QUERY_THRESHOLD;

  return {
    matchCase: false,
    matchDiacritics: useFastExactSearch,
    query: queryPrefix,
  };
}

function getHighlightSearchText(highlight: { text?: string; value: string }) {
  return highlight.text?.trim() || highlight.value;
}

function normalizeForHighlightSearch(value: string) {
  return normalizeInlineText(value).toLocaleLowerCase();
}
