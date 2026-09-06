import { memo, useRef, useState } from "react";
import type { Ref } from "react";
import { ReaderDock } from "./components/reader-dock";
import { BookInfoPage } from "./components/book-info-page";
import { ContentContextMenu } from "./components/context-menu";
import { ReadingProgress } from "./components/reading-progress";
import { SearchBar } from "./components/search-bar";
import { TranslationPopover } from "./components/translation-popover";
import { AnnotationPopover } from "./components/annotation-popover";
import { TocPage } from "./components/toc-page";
import { ThemeDialog } from "./components/theme-dialog";
import type { ReaderUiActions, ReaderUiState } from "./model";

const StableAnnotationPopover = memo(AnnotationPopover);
const StableBookInfoPage = memo(BookInfoPage);
const StableContentContextMenu = memo(ContentContextMenu);
const StableReaderDock = memo(ReaderDock);
const StableSearchBar = memo(SearchBar);
const StableThemeDialog = memo(ThemeDialog);
const StableTocPage = memo(TocPage);
const StableTranslationPopover = memo(TranslationPopover);

export function App({
  actions,
  readerRootRef,
  state,
}: {
  actions: ReaderUiActions;
  readerRootRef?: Ref<HTMLDivElement>;
  state: ReaderUiState;
}) {
  return (
    <>
      <div className="reader-app">
        <StableReaderDock
          onAction={actions.runDockAction}
          onOpenChange={actions.setDockOpen}
          open={state.dockOpen}
          state={state.dock}
        />

        <main className="reader-stage">
          <div id="reader-root" className="reader-frame" ref={readerRootRef} />
        </main>

        <ReadingProgress onSeek={actions.seek} returnRequest={state.progressReturnRequest} update={state.progress} />

        <StableSearchBar
          onClose={actions.closeSearch}
          onNext={actions.nextSearchResult}
          onPrevious={actions.previousSearchResult}
          onSearch={actions.collectSearch}
          state={state.search}
        />
        <StableBookInfoPage bookInfo={state.bookInfo} onClose={actions.closeBookInfo} open={state.bookInfoOpen} />
        <StableTocPage onClose={actions.closeToc} onNavigate={actions.navigateToc} open={state.tocOpen} state={state.toc} />
        <StableThemeDialog onClose={actions.closeTheme} onSelect={actions.selectTheme} selected={state.theme} />
        <StableContentContextMenu onClose={actions.closeContextMenu} state={state.contextMenu} />
        <StableAnnotationPopover
          detail={state.annotation}
          onChange={actions.updateAnnotation}
          onClose={actions.closeAnnotation}
          onDelete={actions.deleteAnnotation}
        />
        <StableTranslationPopover
          detail={state.translation}
          onClose={actions.closeTranslation}
          onDownload={actions.downloadTranslation}
        />
      </div>
      {state.welcome ? (
        <Welcome
          onSelect={(file) => {
            actions.openLocalFile(file);
          }}
          onPick={actions.pickLocalFile}
        />
      ) : null}
    </>
  );
}

function Welcome({
  onSelect,
  onPick,
}: {
  onSelect(file: File): void;
  onPick?: () => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (file?: File) => {
    if (!file) return;
    if (file.type !== "application/epub+zip" && !file.name.toLowerCase().endsWith(".epub")) {
      setSelectionError("Please select an EPUB file.");
      return;
    }
    setSelectionError("");
    onSelect(file);
  };

  const chooseFile = () => {
    if (!onPick) return inputRef.current?.click();
    void onPick().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSelectionError(error instanceof Error ? error.message : "Unable to open EPUB.");
      }
    });
  };

  return (
    <main className="welcome">
      <section
        aria-label="Choose or drop an EPUB file"
        className={`welcome-frame${dragging ? " is-dragging" : ""}`}
        onClick={chooseFile}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          selectFile(event.dataTransfer.files[0]);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          chooseFile();
        }}
        role="button"
        tabIndex={0}
      >
        <img className="welcome-logo" src="./icon.png" alt="" />
        <h1>EPUB.ts</h1>
        <p className="welcome-prompt">Click to choose or drop an EPUB</p>
        {selectionError ? <p className="welcome-error" role="alert">{selectionError}</p> : null}
      </section>
      <input
        ref={inputRef}
        accept="application/epub+zip,.epub"
        className="welcome-input"
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          selectFile(file);
        }}
      />
    </main>
  );
}
