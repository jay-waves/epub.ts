import { useLayoutEffect, useRef } from "react";
import { Slider, SliderRange, SliderThumb, SliderTrack } from "./ui/slider";

export type ReadingProgressElements = {
  currentMarker: HTMLSpanElement;
  fill: HTMLSpanElement;
  historyMarker: HTMLButtonElement;
  root: HTMLSpanElement;
  track: HTMLSpanElement;
};

export function ReadingProgress({
  onReady,
}: {
  onReady?: (elements: ReadingProgressElements | null) => void;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const historyMarkerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const fill = fillRef.current;
    const currentMarker = thumbRef.current;
    const historyMarker = historyMarkerRef.current;
    if (!root || !track || !fill || !currentMarker || !historyMarker) return;

    onReady?.({
      currentMarker,
      fill,
      historyMarker,
      root,
      track,
    });

    return () => {
      onReady?.(null);
    };
  }, [onReady]);

  return (
    <div className="reader-progress-shell">
      <div className="reader-progress-float">
        <Slider
          id="reading-progress"
          className="reader-progress"
          aria-label="Reading progress"
          defaultValue={[0]}
          max={100}
          min={0}
          ref={rootRef}
          step={1}
        >
          <div className="reader-progress-join">
            <SliderTrack className="reader-progress-track" ref={trackRef}>
              <SliderRange id="reading-progress-fill" className="reader-progress-fill" ref={fillRef} />
            </SliderTrack>
            <SliderThumb className="reader-progress-thumb" ref={thumbRef} />
          </div>
        </Slider>
        <button
          aria-label="Return to previous reading position"
          aria-hidden="true"
          className="reader-progress-history-marker"
          ref={historyMarkerRef}
          type="button"
        />
      </div>
    </div>
  );
}

const HISTORY_MARKER_DISMISS_MS = 8000;
const HISTORY_SECTION_JUMP_THRESHOLD = 2;

export function createReadingProgressController(options: {
  currentMarker: HTMLElement;
  fill: HTMLElement;
  historyMarker: HTMLButtonElement;
  root: HTMLElement;
  track: HTMLElement;
  canSeek: () => boolean;
  onSeek: (progress: number) => void;
  onReturn: (progress: number) => void;
}) {
  let currentProgress = 0;
  let currentSectionIndex: number | null = null;
  let dragStartProgress: number | null = null;
  let historyProgress: number | null = null;
  let historyDismissTimer: number | undefined;
  let dispose: (() => void) | null = null;
  let isDragging = false;
  let isBound = false;
  let pendingHistoryProgress: number | null = null;
  let suppressNextHistoryJump = false;

  const clampProgress = (progress: number) => Math.min(1, Math.max(0, progress));

  const getProgressFromPointer = (event: PointerEvent) => {
    const bounds = options.track.getBoundingClientRect();
    if (bounds.width <= 0) return currentProgress;

    return clampProgress((event.clientX - bounds.left) / bounds.width);
  };

  const setProgress = (progress: number) => {
    currentProgress = clampProgress(progress);
    const percentage = currentProgress * 100;
    options.root.style.setProperty("--reader-progress", `${percentage}%`);
    options.currentMarker.setAttribute("aria-valuenow", String(Math.round(percentage)));
    options.fill.style.setProperty("--reader-progress", `${percentage}%`);
    options.fill.style.right = `${100 - percentage}%`;
    options.root.setAttribute("aria-valuenow", String(Math.round(currentProgress * 100)));
  };

  const commitHistoryProgress = (progress: number) => {
    setHistoryProgress(progress);
    scheduleHistoryDismiss();
  };

  const seek = (progress: number, seekOptions: { historyOriginProgress?: number } = {}) => {
    if (!options.canSeek()) return;

    const nextProgress = clampProgress(progress);
    const originProgress = typeof seekOptions.historyOriginProgress === "number"
      ? clampProgress(seekOptions.historyOriginProgress)
      : null;

    if (originProgress != null && Math.abs(nextProgress - originProgress) > 0.001) {
      pendingHistoryProgress = originProgress;
      suppressNextHistoryJump = true;
    }

    setProgress(nextProgress);
    options.onSeek(currentProgress);
  };

  const clearHistoryDismissTimer = () => {
    window.clearTimeout(historyDismissTimer);
    historyDismissTimer = undefined;
  };

  const scheduleHistoryDismiss = () => {
    clearHistoryDismissTimer();
    historyDismissTimer = window.setTimeout(() => {
      setHistoryProgress(null);
    }, HISTORY_MARKER_DISMISS_MS);
  };

  const setHistoryProgress = (progress: number | null) => {
    historyProgress = typeof progress === "number" ? clampProgress(progress) : null;
    if (historyProgress == null) {
      clearHistoryDismissTimer();
      options.historyMarker.classList.remove("is-history-visible");
      options.historyMarker.setAttribute("aria-hidden", "true");
      return;
    }

    clearHistoryDismissTimer();
    options.historyMarker.classList.add("is-history-visible");
    options.historyMarker.setAttribute("aria-hidden", "false");
  };

  const handleRelocate = (detail: { fraction?: number; index?: number }) => {
    const nextProgress = typeof detail.fraction === "number" ? detail.fraction : currentProgress;
    const nextIndex = typeof detail.index === "number" ? detail.index : null;

    if (pendingHistoryProgress != null) {
      commitHistoryProgress(pendingHistoryProgress);
      pendingHistoryProgress = null;
    } else if (
      nextIndex != null
      && currentSectionIndex != null
      && Math.abs(nextIndex - currentSectionIndex) > HISTORY_SECTION_JUMP_THRESHOLD
      && !isDragging
      && !suppressNextHistoryJump
    ) {
      commitHistoryProgress(currentProgress);
    }

    suppressNextHistoryJump = false;
    currentSectionIndex = nextIndex;
    setProgress(nextProgress);
  };

  const returnToHistory = () => {
    if (historyProgress == null || !options.canSeek()) return;

    const targetProgress = historyProgress;
    pendingHistoryProgress = null;
    suppressNextHistoryJump = true;
    setHistoryProgress(null);
    setProgress(targetProgress);
    options.onReturn(targetProgress);
  };

  const bind = () => {
    if (isBound) return;
    isBound = true;

    const clearFloatingFocus = () => {
      const shell = options.root.closest(".reader-progress-shell");
      const activeElement = document.activeElement;
      if (shell && activeElement instanceof HTMLElement && shell.contains(activeElement)) {
        activeElement.blur();
      }
      if (options.root instanceof HTMLElement) options.root.blur();
      options.historyMarker.blur();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(".reader-progress-history-marker")) {
        return;
      }

      event.preventDefault();
      dragStartProgress = currentProgress;
      isDragging = true;
      options.root.classList.add("is-dragging");
      options.fill.style.transitionDuration = "0ms";
      options.root.setPointerCapture(event.pointerId);
      setProgress(getProgressFromPointer(event));
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!options.root.hasPointerCapture(event.pointerId)) return;
      setProgress(getProgressFromPointer(event));
    };

    const finishDrag = (event: PointerEvent) => {
      if (!options.root.hasPointerCapture(event.pointerId)) return;

      const progress = getProgressFromPointer(event);
      const originProgress = dragStartProgress;
      dragStartProgress = null;
      options.root.releasePointerCapture(event.pointerId);
      isDragging = false;
      options.root.classList.remove("is-dragging");
      options.fill.style.transitionDuration = "";
      seek(progress, { historyOriginProgress: originProgress ?? currentProgress });
    };

    const handleHistoryPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleHistoryClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      returnToHistory();
      clearFloatingFocus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        seek(currentProgress - 0.01, { historyOriginProgress: currentProgress });
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        seek(currentProgress + 0.01, { historyOriginProgress: currentProgress });
      } else if (event.key === "Home") {
        event.preventDefault();
        seek(0, { historyOriginProgress: currentProgress });
      } else if (event.key === "End") {
        event.preventDefault();
        seek(1, { historyOriginProgress: currentProgress });
      } else if (event.key === "Escape") {
        event.preventDefault();
        returnToHistory();
      }
    };

    options.root.addEventListener("pointerdown", handlePointerDown);
    options.root.addEventListener("pointermove", handlePointerMove);
    options.root.addEventListener("pointerup", finishDrag);
    options.root.addEventListener("pointercancel", finishDrag);
    options.historyMarker.addEventListener("pointerdown", handleHistoryPointerDown);
    options.historyMarker.addEventListener("click", handleHistoryClick);
    options.root.addEventListener("keydown", handleKeyDown);

    dispose = () => {
      clearHistoryDismissTimer();
      options.root.removeEventListener("pointerdown", handlePointerDown);
      options.root.removeEventListener("pointermove", handlePointerMove);
      options.root.removeEventListener("pointerup", finishDrag);
      options.root.removeEventListener("pointercancel", finishDrag);
      options.historyMarker.removeEventListener("pointerdown", handleHistoryPointerDown);
      options.historyMarker.removeEventListener("click", handleHistoryClick);
      options.root.removeEventListener("keydown", handleKeyDown);
      options.root.classList.remove("is-dragging");
      dragStartProgress = null;
      pendingHistoryProgress = null;
      isBound = false;
      dispose = null;
    };
  };

  return {
    bind,
    destroy: () => {
      dispose?.();
    },
    getProgress: () => currentProgress,
    handleRelocate,
    setProgress,
    setHistoryProgress,
  };
}
