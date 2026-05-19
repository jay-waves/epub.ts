import { useEffect, useRef, useState } from "react";
import { VIEWER_EVENTS } from "../viewer-events";
import type { SearchUpdateDetail } from "../viewer-events";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip } from "./ui/tooltip";

export function SearchBar() {
  const [canNavigate, setCanNavigate] = useState(false);
  const [countText, setCountText] = useState("0 / 0");
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
      new CustomEvent(VIEWER_EVENTS.searchCollect, {
        detail: { query },
      }),
    );
  };

  const clearSearch = () => {
    setQuery("");
    window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchClear));
  };

  return (
    <div id="search-nav" className="search-nav" hidden={!visible}>
      <Tooltip label="Previous result" side="bottom">
        <Button
          id="search-prev-button"
          aria-label="Previous result"
          disabled={!canNavigate}
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchPrevious))}
        >
          <i data-lucide="chevron-left" />
        </Button>
      </Tooltip>
      <span id="search-count" className="search-count">
        {countText}
      </span>
      <Tooltip label="Next result" side="bottom">
        <Button
          id="search-next-button"
          aria-label="Next result"
          disabled={!canNavigate}
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchNext))}
        >
          <i data-lucide="chevron-right" />
        </Button>
      </Tooltip>
      <form
        id="search-form"
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <Input
          id="search-input"
          className="search-input"
          type="search"
          placeholder={placeholder}
          autoComplete="off"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </form>
      <Tooltip label="Close search" side="bottom">
        <Button
          id="search-close-button"
          aria-label="Close search"
          variant="ghost"
          size="icon"
          onClick={clearSearch}
        >
          <i data-lucide="x" />
        </Button>
      </Tooltip>
    </div>
  );
}
