import type { TocItem } from "./foliate";
import type { PlatformDocument } from "./platform/types";

export type BookSession = ReturnType<typeof createBookSession>;

export function createBookSession(initialTitle: string) {
  return {
    bookKey: "",
    document: null as PlatformDocument | null,
    dirty: false,
    documentTitle: initialTitle,
    href: "",
    restoring: false,
    restoreScrollPending: false,
    scrolledSectionIndex: null as number | null,
    scrolledSectionProgress: new Map<number, number>(),
    sourceLabel: "",
    sourceUrl: "",
    tocItems: [] as TocItem[],
  };
}

export function resetBookSession(
  session: BookSession,
  source: Pick<BookSession, "bookKey" | "document" | "documentTitle" | "sourceLabel" | "sourceUrl">,
) {
  Object.assign(session, createBookSession(source.documentTitle), source);
}
