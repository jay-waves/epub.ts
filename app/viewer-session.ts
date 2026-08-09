import type { TocItem } from "./foliate";
import type { PlatformDocument } from "./platform/types";

type BookSession = ReturnType<typeof createBookSession>;

export function createBookSession() {
  return {
    bookKey: "",
    document: null as PlatformDocument | null,
    dirty: false,
    href: "",
    restoring: false,
    restoreScrollPending: false,
    scrolledSectionIndex: null as number | null,
    scrolledSectionProgress: new Map<number, number>(),
    tocItems: [] as TocItem[],
  };
}

export function resetBookSession(
  session: BookSession,
  source: Pick<BookSession, "bookKey" | "document">,
) {
  Object.assign(session, createBookSession(), source);
}
