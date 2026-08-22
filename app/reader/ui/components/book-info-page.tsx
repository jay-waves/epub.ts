import { useRef, useState } from "react";
import { emitViewerEvent, VIEWER_EVENTS } from "../../events";
import type { BookInfo } from "../../book-info";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

const emptyBookInfo: BookInfo = {
  fontFamily: "serif",
  fonts: { serif: "eb-garamond", sans: "noto-sans", mono: "monaspace-argon" },
  metadataRows: [],
  statsRows: [],
  title: "Book information",
};

export function BookInfoPage() {
  const [bookInfo, setBookInfo] = useState<BookInfo>(emptyBookInfo);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useViewerEvent(VIEWER_EVENTS.bookInfoOpen, () => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  });
  useViewerEvent(VIEWER_EVENTS.bookInfoUpdate, setBookInfo);

  return (
    <Dialog
      id="book-info-modal"
      aria-label="Book information"
      className="toc-modal-box book-info-modal-box"
      ref={dialogRef}
    >
      <div className="book-info-root">
        {bookInfo.statsRows.length || bookInfo.metadataRows.length ? (
          <>
            <header className="book-info-header">
              <h2 className="book-info-title">{bookInfo.title}</h2>
              {bookInfo.subtitle ? <p className="book-info-subtitle">{bookInfo.subtitle}</p> : null}
            </header>

            <section className="book-info-section" aria-labelledby="book-info-reading">
              <h2 id="book-info-reading" className="book-info-section-title">Reading</h2>
              <div className="book-info-stats">
                {bookInfo.statsRows.map((row) => (
                  <div className="book-info-stat" key={row.label}>
                    <span className="book-info-stat-value">{row.value}</span>
                    <span className="book-info-stat-label">{row.label}</span>
                  </div>
                ))}
              </div>
              <dl className="book-info-list">
                {bookInfo.metadataRows.map((row) => (
                  <div className="book-info-row" key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
            </section>

            <section className="book-info-section" aria-labelledby="book-info-settings">
              <h2 id="book-info-settings" className="book-info-section-title">Reading settings</h2>
              <label className="book-info-control">
                <span>Body</span>
                <select
                  value={bookInfo.fontFamily}
                  onChange={(event) => emitViewerEvent(
                    VIEWER_EVENTS.bookInfoFontChange,
                    event.currentTarget.value as BookInfo["fontFamily"],
                  )}
                >
                  <option value="serif">Serif</option>
                  <option value="sans">Sans</option>
                  <option value="mono">Mono</option>
                </select>
              </label>
              <label className="book-info-control">
                <span>Serif</span>
                <select value={bookInfo.fonts.serif} onChange={(event) => emitViewerEvent(
                  VIEWER_EVENTS.bookInfoFontsChange,
                  { ...bookInfo.fonts, serif: event.currentTarget.value as BookInfo["fonts"]["serif"] },
                )}>
                  <option value="eb-garamond">EB Garamond</option>
                  <option value="noto-serif">Noto Serif</option>
                  <option value="system-serif">System serif</option>
                </select>
              </label>
              <label className="book-info-control">
                <span>Sans</span>
                <select value={bookInfo.fonts.sans} onChange={(event) => emitViewerEvent(
                  VIEWER_EVENTS.bookInfoFontsChange,
                  { ...bookInfo.fonts, sans: event.currentTarget.value as BookInfo["fonts"]["sans"] },
                )}>
                  <option value="noto-sans">Noto Sans</option>
                  <option value="system-sans">System sans</option>
                </select>
              </label>
              <label className="book-info-control">
                <span>Mono</span>
                <select value={bookInfo.fonts.mono} onChange={(event) => emitViewerEvent(
                  VIEWER_EVENTS.bookInfoFontsChange,
                  { ...bookInfo.fonts, mono: event.currentTarget.value as BookInfo["fonts"]["mono"] },
                )}>
                  <option value="monaspace-argon">Monaspace Argon</option>
                  <option value="fira-code">Fira Code</option>
                  <option value="system-mono">System mono</option>
                </select>
              </label>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Open a book to show its information.</p>
        )}
      </div>
    </Dialog>
  );
}
