import type { TocItem } from "../renderer";
import type { PlatformDocument } from "../platform/types";

type BookSession = ReturnType<typeof createBookSession>;

export function createBookSession() {
  return {
    bookKey: "",
    document: null as PlatformDocument | null,
    dirty: false,
    href: "",
    tocItem: null as TocItem | null,
    tocIntent: null as TocItem | null,
    progress: 0,
    sectionIndex: 0,
    restoring: false,
    tocItems: [] as TocItem[],
  };
}

export function resetBookSession(
  session: BookSession,
  source: Pick<BookSession, "bookKey" | "document">,
) {
  Object.assign(session, createBookSession(), source);
}
