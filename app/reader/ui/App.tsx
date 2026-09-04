import { useEffect, useRef, useState } from "react";
import { ReaderDock } from "./components/reader-dock";
import { BookInfoPage } from "./components/book-info-page";
import { ContentContextMenu } from "./components/context-menu";
import { ReadingProgress } from "./components/reading-progress";
import { SearchBar } from "./components/search-bar";
import { TranslationPopover } from "./components/translation-popover";
import { AnnotationPopover } from "./components/annotation-popover";
import { TocPage } from "./components/toc-page";
import { ThemeDialog } from "./components/theme-dialog";
import { listenViewerEvent, VIEWER_EVENTS } from "../events";

export function App({
  onOpenLocalFile,
  onPickLocalFile,
  showWelcomeInitially,
}: {
  onOpenLocalFile: (file: File) => void;
  onPickLocalFile?: () => Promise<void>;
  showWelcomeInitially: boolean;
}) {
  const [showWelcome, setShowWelcome] = useState(showWelcomeInitially);

  useEffect(() => {
    const close = listenViewerEvent(VIEWER_EVENTS.documentOpen, () => setShowWelcome(false));
    const open = listenViewerEvent(VIEWER_EVENTS.welcomeOpen, () => setShowWelcome(true));
    return () => {
      close();
      open();
    };
  }, []);

  return (
    <>
      <div className="reader-app">
        <ReaderDock />

        <main className="reader-stage">
          <div id="reader-root" className="reader-frame" />
        </main>

        <ReadingProgress />

        <SearchBar />
        <BookInfoPage />
        <TocPage />
        <ThemeDialog />
        <ContentContextMenu />
        <AnnotationPopover />
        <TranslationPopover />
      </div>
      {showWelcome ? (
        <Welcome
          onSelect={(file) => {
            setShowWelcome(false);
            onOpenLocalFile(file);
          }}
          onPick={onPickLocalFile ? async () => {
            await onPickLocalFile();
            setShowWelcome(false);
          } : undefined}
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
        <p className="welcome-prompt">A quiet place for your books</p>
        <span className="welcome-action">Choose EPUB</span>
        <p className="welcome-hint">or drop a file here</p>
        <input
          ref={inputRef}
          className="welcome-input"
          type="file"
          accept="application/epub+zip,.epub"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            selectFile(file);
          }}
        />
        {selectionError ? <p className="welcome-error" role="alert">{selectionError}</p> : null}
      </section>
    </main>
  );
}
