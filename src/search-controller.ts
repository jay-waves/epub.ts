import type { FoliateViewElement, SearchHit } from "./viewer-types";
import { emitViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import type { SearchUpdateDetail } from "./viewer-events";
import { normalizeInlineText } from "./text-utils";
import { getSavedHighlights } from "./viewer-storage";

const LONG_SEARCH_QUERY_THRESHOLD = 24;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 200;

export function createSearchController(options: {
  getBookKey: () => string;
  getReaderView: () => FoliateViewElement | null;
  runWithReaderRenderPending?: (action: () => Promise<unknown> | undefined) => Promise<void>;
}) {
  let searchRunId = 0;
  let searchHits: SearchHit[] = [];
  let searchHitIndex = -1;

  const emitUpdate = (detail: SearchUpdateDetail) => {
    emitViewerEvent(VIEWER_EVENTS.searchUpdate, detail);
  };

  const clearHighlights = () => {
    options.getReaderView()?.clearSearch?.();
  };

  const updateNav = (visible = searchHits.length > 0) => {
    emitUpdate({
      hitCount: searchHits.length,
      hitIndex: searchHitIndex,
      placeholder: "Search text",
      visible,
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
      const navigate = () => readerView.select?.(hit.cfi) ?? readerView.goTo(hit.cfi);
      if (options.runWithReaderRenderPending) {
        await options.runWithReaderRenderPending(navigate);
      } else {
        await navigate();
      }
    } catch (error) {
      console.warn("Failed to navigate to search hit.", error);
    }
  };

  const clear = () => {
    ++searchRunId;
    searchHits = [];
    searchHitIndex = -1;
    updateNav(false);
    clearHighlights();
  };

  const collectHighlights = async (query: string) => {
    const bookKey = options.getBookKey();
    if (!bookKey) return;

    const searchOptions = getSearchOptions(query);
    clearHighlights();
    searchHits = [];
    searchHitIndex = -1;
    updateNav(true);

    const normalizedQuery = normalizeForHighlightSearch(searchOptions.query);
    const highlights = await getSavedHighlights(bookKey);

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

    updateNav();
    if (searchHits.length) {
      await showHit(0);
    } else {
      emitUpdate({
        hitCount: 0,
        hitIndex: -1,
        placeholder: searchOptions.query ? `No highlights for: ${searchOptions.query}` : "No highlights saved",
        visible: true,
      });
    }
  };

  const collect = async (query: string, collectOptions: { highlightedOnly?: boolean } = {}) => {
    if (collectOptions.highlightedOnly) {
      await collectHighlights(query);
      return;
    }

    const readerView = options.getReaderView();
    if (!readerView?.search) return;

    const searchOptions = getSearchOptions(query);
    clearHighlights();
    searchHits = [];
    searchHitIndex = -1;
    updateNav(true);

    if (!searchOptions.query) return;

    const runId = ++searchRunId;

    try {
      searchBook:
      for await (const entry of readerView.search(searchOptions)) {
        if (runId !== searchRunId) return;
        if (entry === "done") break;

        if (typeof entry === "object" && entry) {
          const hits =
            "subitems" in entry && Array.isArray(entry.subitems)
              ? (entry.subitems as SearchHit[])
              : "cfi" in entry
                ? [entry as SearchHit]
                : [];

          for (const hit of hits) {
            searchHits.push({ cfi: hit.cfi, excerpt: hit.excerpt });
            if (searchHits.length >= MAX_SEARCH_RESULTS) break searchBook;
          }
        }
      }

      if (runId !== searchRunId) return;
      updateNav();
      if (searchHits.length) {
        await showHit(0);
      } else {
        emitUpdate({
          hitCount: 0,
          hitIndex: -1,
          placeholder: `No results for: ${searchOptions.query}`,
          visible: true,
        });
      }
    } catch (error) {
      if (runId !== searchRunId) return;
      console.error("Search failed.", error);
      updateNav();
    }
  };

  const showPrevious = () => showHit(searchHitIndex - 1);
  const showNext = () => showHit(searchHitIndex + 1);

  return { clear, collect, showNext, showPrevious };
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
