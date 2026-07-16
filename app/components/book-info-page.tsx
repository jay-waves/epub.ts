import { useEffect, useRef, useState } from "react";
import { listenViewerEvent, VIEWER_EVENTS } from "../viewer-events";
import type { BookInfoUpdateDetail } from "../viewer-events";
import { Dialog } from "./ui";

const emptyBookInfo: BookInfoUpdateDetail = {
  metadataRows: [],
  statsRows: [],
  title: "Book information",
};

export function BookInfoPage() {
  const [bookInfo, setBookInfo] = useState<BookInfoUpdateDetail>(emptyBookInfo);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const open = () => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
    };

    const stopOpen = listenViewerEvent(VIEWER_EVENTS.bookInfoOpen, open);
    const stopUpdate = listenViewerEvent(VIEWER_EVENTS.bookInfoUpdate, setBookInfo);
    return () => {
      stopOpen();
      stopUpdate();
    };
  }, []);

  const hasDetails = bookInfo.metadataRows.length || bookInfo.statsRows.length;

  return (
    <Dialog
      id="book-info-modal"
      className="toc-modal-box book-info-modal-box"
      ref={dialogRef}
    >
      <div className="book-info-root">
        {hasDetails ? (
          <>
            <header className="book-info-header">
              <h2 className="book-info-title">{bookInfo.title}</h2>
              {bookInfo.subtitle ? <p className="book-info-subtitle">{bookInfo.subtitle}</p> : null}
            </header>

            <section className="book-info-section" aria-label="Reading estimate">
              {bookInfo.statsRows.map((row) => (
                <div className="book-info-stat" key={row.label}>
                  <span className="book-info-stat-value">{row.value}</span>
                  <span className="book-info-stat-label">{row.label}</span>
                </div>
              ))}
            </section>

            <dl className="book-info-list">
              {bookInfo.metadataRows.map((row) => (
                <div className="book-info-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Open a book to show its information.</p>
        )}
      </div>
    </Dialog>
  );
}
