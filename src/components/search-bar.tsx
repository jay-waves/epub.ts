import { useEffect, useRef, useState } from "react";
import { VIEWER_EVENTS } from "../viewer-events";
import type { SearchCollectDetail, SearchUpdateDetail } from "../viewer-events";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip } from "./ui/tooltip";
import { ChevronLeft, ChevronRight, X, Highlighter } from "lucide-react"

export function SearchBar() {
  const [canNavigate, setCanNavigate] = useState(false);
  const [countText, setCountText] = useState("0 / 0");
  const [highlightedOnly, setHighlightedOnly] = useState(false);
  const [placeholder, setPlaceholder] = useState("Search text");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOpen = () => {
      setPlaceholder("Search text");
      setVisible(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<SearchUpdateDetail>).detail;
      setCanNavigate(detail.canNavigate);
      setCountText(detail.countText);
      setPlaceholder(detail.placeholder);
      setVisible(detail.visible);
    };

    window.addEventListener(VIEWER_EVENTS.searchOpen, handleOpen);
    window.addEventListener(VIEWER_EVENTS.searchUpdate, handleUpdate);
    return () => {
      window.removeEventListener(VIEWER_EVENTS.searchOpen, handleOpen);
      window.removeEventListener(VIEWER_EVENTS.searchUpdate, handleUpdate);
    };
  }, []);

  const submitSearch = () => {
    window.dispatchEvent(
      new CustomEvent<SearchCollectDetail>(VIEWER_EVENTS.searchCollect, {
        detail: { highlightedOnly, query },
      }),
    );
  };

  const toggleHighlightedOnly = () => {
    const nextHighlightedOnly = !highlightedOnly;
    setHighlightedOnly(nextHighlightedOnly);
    if (!nextHighlightedOnly) return;

    window.dispatchEvent(
      new CustomEvent<SearchCollectDetail>(VIEWER_EVENTS.searchCollect, {
        detail: { highlightedOnly: true, query },
      }),
    );
  };

  const clearSearch = () => {
    setHighlightedOnly(false);
    setQuery("");
    window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchClear));
  };

  return (
    <div className="search-nav" hidden={!visible}>
      <Tooltip label="Previous result" side="bottom">
        <Button
          aria-label="Previous result"
          disabled={!canNavigate}
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchPrevious))}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
      </Tooltip>
      <span className="search-count">
        {countText}
      </span>
      <Tooltip label="Next result" side="bottom">
        <Button
          aria-label="Next result"
          disabled={!canNavigate}
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchNext))}
        >
          <ChevronRight size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <Input
          className="search-input"
          type="search"
          placeholder={placeholder}
          autoComplete="off"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </form>
      <Tooltip label="Search highlights only" side="bottom">
        <Button
          aria-label="Search highlights only"
          aria-pressed={highlightedOnly}
          className={highlightedOnly ? "search-mode-active" : undefined}
          variant="ghost"
          size="icon"
          onClick={toggleHighlightedOnly}
        >
          <Highlighter size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
      <Tooltip label="Close search" side="bottom">
        <Button
          aria-label="Close search"
          variant="ghost"
          size="icon"
          onClick={clearSearch}
        >
          <X size={20} aria-hidden="true"/>
        </Button>
      </Tooltip>
    </div>
  );
}
