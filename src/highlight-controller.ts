import { Copy, LocateFixed, MessageSquareText, Trash2 } from "lucide";
import type { IconNode } from "lucide";
import type { ReaderHighlight } from "./viewer-types";

type HighlightControllerOptions = {
  root: HTMLElement;
  modal: HTMLDialogElement;
  onComment: (highlight: ReaderHighlight, note: string) => void | Promise<void>;
  onCopy: (highlight: ReaderHighlight) => void | Promise<void>;
  onDelete: (highlight: ReaderHighlight) => void | Promise<void>;
  onOpenHighlight: (highlight: ReaderHighlight) => void | Promise<void>;
};

export function createHighlightController(options: HighlightControllerOptions) {
  let highlights: ReaderHighlight[] = [];
  let activeValue = "";

  const render = (restoreScrollTop?: number) => {
    options.root.replaceChildren(createPanel(), createActionBar());
    if (typeof restoreScrollTop === "number") {
      const list = options.root.querySelector<HTMLElement>(".highlights-list");
      if (list) list.scrollTop = restoreScrollTop;
    }
  };

  const getListScrollTop = () =>
    options.root.querySelector<HTMLElement>(".highlights-list")?.scrollTop ?? 0;

  const setHighlights = (nextHighlights: ReaderHighlight[]) => {
    highlights = nextHighlights.slice().sort(compareHighlights);
    if (!highlights.some((highlight) => highlight.value === activeValue)) activeValue = "";
    render();
  };

  const open = () => {
    render();
    options.modal.showModal();
  };

  const openHighlight = (value: string, focusComment = false) => {
    activeValue = value;
    open();
    window.setTimeout(() => {
      const item = scrollToHighlight(value);
      if (focusComment) options.root.querySelector<HTMLTextAreaElement>(".highlights-note-input")?.focus();
      return item;
    }, 0);
  };

  const scrollToHighlight = (value: string) => {
    const item = options.root.querySelector<HTMLElement>(`[data-highlight-value="${CSS.escape(value)}"]`);
    item?.scrollIntoView({ block: "center", behavior: "smooth" });
    return item;
  };

  const close = () => {
    options.modal.close();
  };

  const createActionButton = (
    label: string,
    icon: IconNode,
    toneClass: string,
    onClick: () => void | Promise<void>,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm btn-square ${toneClass}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(createIcon(icon));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void onClick();
    });
    return button;
  };

  const createIcon = (icon: IconNode) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    for (const [tag, attrs] of icon) {
      const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attrs)) child.setAttribute(name, String(value));
      svg.append(child);
    }

    return svg;
  };

  const createList = () => {
    const list = document.createElement("div");
    list.className = "highlights-list";

    if (!highlights.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-base-content/60";
      empty.textContent = "Select text and use the context menu to create highlights.";
      list.append(empty);
      return list;
    }

    for (const highlight of highlights) list.append(createItem(highlight));
    return list;
  };

  const createItem = (highlight: ReaderHighlight) => {
    const isActive = highlight.value === activeValue;
    const item = document.createElement("article");
    item.className = `highlight-item${isActive ? " is-active" : ""}`;
    item.dataset.highlightValue = highlight.value;
    item.setAttribute("aria-selected", isActive ? "true" : "false");
    item.tabIndex = 0;
    item.addEventListener("click", () => {
      const scrollTop = getListScrollTop();
      activeValue = highlight.value;
      render(scrollTop);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const scrollTop = getListScrollTop();
      activeValue = highlight.value;
      render(scrollTop);
    });

    const progress = document.createElement("span");
    progress.className = "highlight-progress";
    progress.textContent = formatProgress(highlight);

    const body = document.createElement("span");
    body.className = "highlight-item-body";

    const text = document.createElement("span");
    text.className = "highlight-text";
    text.textContent = highlight.text || highlight.value;
    body.append(text);

    if (highlight.note) {
      const note = document.createElement("span");
      note.className = "highlight-note";
      note.textContent = highlight.note;
      body.append(note);
    }

    item.append(progress, body);
    return item;
  };

  const createPanel = () => {
    const panel = document.createElement("div");
    panel.className = "highlights-panel";
    panel.append(createList());
    return panel;
  };

  const createActionBar = () => {
    const selected = highlights.find((highlight) => highlight.value === activeValue);
    const wrapper = document.createElement("div");
    wrapper.className = "highlight-action-bar";
    wrapper.addEventListener("click", (event) => event.stopPropagation());

    const noteInput = document.createElement("textarea");
    noteInput.className = "textarea textarea-bordered textarea-sm highlights-note-input";
    noteInput.placeholder = selected ? "Comment" : "Select a highlight";
    noteInput.value = selected?.note ?? "";
    noteInput.disabled = !selected;

    const actions = document.createElement("div");
    actions.className = "highlights-actions";
    actions.append(
      createActionButton("Go to highlight", LocateFixed, "highlight-icon-button", async () => {
        if (selected) await options.onOpenHighlight(selected);
      }),
      createActionButton("Copy", Copy, "highlight-icon-button", async () => {
        if (selected) await options.onCopy(selected);
      }),
      createActionButton("Comment", MessageSquareText, "highlight-icon-button", async () => {
        if (selected) await options.onComment(selected, noteInput.value.trim());
      }),
      createActionButton("Delete", Trash2, "highlight-icon-button", async () => {
        if (selected) await options.onDelete(selected);
      }),
    );

    for (const button of actions.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = !selected;
    }

    wrapper.append(noteInput, actions);
    return wrapper;
  };

  const formatProgress = (highlight: ReaderHighlight) => {
    if (typeof highlight.fraction === "number") return `${Math.round(highlight.fraction * 100)}%`;
    return "--";
  };

  const compareHighlights = (first: ReaderHighlight, second: ReaderHighlight) => {
    if (typeof first.fraction === "number" && typeof second.fraction === "number") {
      return first.fraction - second.fraction;
    }
    if (typeof first.fraction === "number") return -1;
    if (typeof second.fraction === "number") return 1;
    if (typeof first.index === "number" && typeof second.index === "number") {
      return first.index - second.index;
    }
    return first.createdAt - second.createdAt;
  };

  return {
    close,
    open,
    openHighlight,
    render,
    setHighlights,
  };
}
