import { useRef, useState } from "react";
import { VIEWER_EVENTS } from "../../events";
import type { BookInfo } from "../../book-info";
import { Dialog } from "./ui";
import { useViewerEvent } from "./use-viewer-event";

const emptyBookInfo: BookInfo = {
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
                {[...bookInfo.statsRows, ...bookInfo.metadataRows].map((row) => (
                  <div className={`book-info-stat${row.wide ? " book-info-stat-wide" : ""}`} key={row.label}>
                    <span className="book-info-stat-value">{row.value}</span>
                    <span className="book-info-stat-label">{row.label}</span>
                  </div>
                ))}
              </div>
            </section>

          </>
        ) : (
          <p className="text-sm text-muted-foreground">Open a book to show its information.</p>
        )}
      </div>
    </Dialog>
  );
}
