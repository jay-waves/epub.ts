import type { FoliateViewElement, SearchHit } from "./viewer-types";

const LONG_SEARCH_QUERY_THRESHOLD = 24;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 200;

export function createSearchController(options: {
  openSearchButton: HTMLButtonElement;
  searchNav: HTMLElement;
  searchInput: HTMLInputElement;
  searchCount: HTMLElement;
  searchPrevButton: HTMLButtonElement;
  searchNextButton: HTMLButtonElement;
  getReaderView: () => FoliateViewElement | null;
}) {
  let searchRunId = 0;
  let searchHits: SearchHit[] = [];
  let searchHitIndex = -1;

  const updateButton = () => {
    const canSearch = Boolean(options.getReaderView()?.search);
    options.openSearchButton.disabled = !canSearch;
    options.openSearchButton.setAttribute("aria-disabled", canSearch ? "false" : "true");
  };

  const clearHighlights = () => {
    options.getReaderView()?.clearSearch?.();
  };

  const updateNav = () => {
    const hasHits = searchHits.length > 0;
    const isSearching = document.activeElement === options.searchInput || Boolean(options.searchInput.value.trim());
    options.searchNav.hidden = !hasHits && !isSearching;
    options.searchCount.textContent = hasHits ? `${searchHitIndex + 1} / ${searchHits.length}` : "0 / 0";
    options.searchPrevButton.disabled = !hasHits;
    options.searchNextButton.disabled = !hasHits;
  };

  const showHit = async (index: number) => {
    const readerView = options.getReaderView();
    if (!readerView || !searchHits.length) return;

    searchHitIndex = (index + searchHits.length) % searchHits.length;
    updateNav();

    const hit = searchHits[searchHitIndex];
    if (!hit) return;

    try {
      await (readerView.select?.(hit.cfi) ?? readerView.goTo(hit.cfi));
    } catch (error) {
      console.warn("Failed to navigate to search hit.", error);
    }
  };

  const clear = () => {
    ++searchRunId;
    searchHits = [];
    searchHitIndex = -1;
    options.searchInput.value = "";
    options.searchInput.placeholder = "Search text";
    options.searchNav.hidden = true;
    clearHighlights();
  };

  const collect = async (query: string) => {
    const readerView = options.getReaderView();
    if (!readerView?.search) return;

    const searchOptions = getSearchOptions(query);
    clearHighlights();
    searchHits = [];
    searchHitIndex = -1;
    updateNav();

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
        options.searchInput.select();
        options.searchInput.placeholder = `No results for: ${searchOptions.query}`;
        updateNav();
      }
    } catch (error) {
      if (runId !== searchRunId) return;
      console.error("Search failed.", error);
      updateNav();
    }
  };

  const showPrevious = () => showHit(searchHitIndex - 1);
  const showNext = () => showHit(searchHitIndex + 1);

  return { clear, collect, showHit, showNext, showPrevious, updateButton };
}

function getSearchOptions(query: string) {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const queryPrefix = normalizedQuery.slice(0, MAX_SEARCH_QUERY_LENGTH).trim();
  const useFastExactSearch = queryPrefix.length >= LONG_SEARCH_QUERY_THRESHOLD;

  return {
    matchCase: false,
    matchDiacritics: useFastExactSearch,
    query: queryPrefix,
  };
}
