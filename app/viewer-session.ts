import type { TocItem } from "./foliate";
import type { WritableFileHandle } from "./platform";

export type BookSession = ReturnType<typeof createBookSession>;

export function createBookSession(initialTitle: string) {
  return {
    bookKey: "",
    dirty: false,
    documentTitle: initialTitle,
    href: "",
    localSourceUrl: null as string | null,
    restoring: false,
    restoreScrollPending: false,
    saveHandle: undefined as WritableFileHandle | null | undefined,
    scrolledSectionIndex: null as number | null,
    scrolledSectionProgress: new Map<number, number>(),
    sourceLabel: "",
    sourceUrl: "",
    tocItems: [] as TocItem[],
  };
}

export function resetBookSession(
  session: BookSession,
  source: Pick<BookSession, "bookKey" | "documentTitle" | "localSourceUrl" | "sourceLabel" | "sourceUrl">,
) {
  Object.assign(session, createBookSession(source.documentTitle), source);
}
