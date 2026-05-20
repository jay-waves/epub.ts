export function ReadingProgress() {
  return (
    <div
      id="reading-progress"
      className="reader-progress"
      role="slider"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      tabIndex={0}
    >
      <div className="reader-progress-track">
        <div id="reading-progress-fill" className="reader-progress-fill" />
      </div>
    </div>
  );
}

export function createReadingProgressController(options: {
  fill: HTMLElement;
  root: HTMLElement;
  track: HTMLElement;
  canSeek: () => boolean;
  onSeek: (progress: number) => void;
}) {
  let currentProgress = 0;

  const clampProgress = (progress: number) => Math.min(1, Math.max(0, progress));

  const getProgressFromPointer = (event: PointerEvent) => {
    const bounds = options.track.getBoundingClientRect();
    if (bounds.width <= 0) return currentProgress;

    return clampProgress((event.clientX - bounds.left) / bounds.width);
  };

  const setProgress = (progress: number) => {
    currentProgress = clampProgress(progress);
    options.fill.style.setProperty("--reader-progress", `${currentProgress * 100}%`);
    options.root.setAttribute("aria-valuenow", String(Math.round(currentProgress * 100)));
  };

  const seek = (progress: number) => {
    if (!options.canSeek()) return;

    setProgress(progress);
    options.onSeek(currentProgress);
  };

  const bind = () => {
    options.root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;

      event.preventDefault();
      options.root.classList.add("is-dragging");
      options.fill.style.transitionDuration = "0ms";
      options.root.setPointerCapture(event.pointerId);
      setProgress(getProgressFromPointer(event));
    });

    options.root.addEventListener("pointermove", (event) => {
      if (!options.root.hasPointerCapture(event.pointerId)) return;
      setProgress(getProgressFromPointer(event));
    });

    const finishDrag = (event: PointerEvent) => {
      if (!options.root.hasPointerCapture(event.pointerId)) return;

      const progress = getProgressFromPointer(event);
      options.root.releasePointerCapture(event.pointerId);
      options.root.classList.remove("is-dragging");
      options.fill.style.transitionDuration = "";
      seek(progress);
    };

    options.root.addEventListener("pointerup", finishDrag);
    options.root.addEventListener("pointercancel", finishDrag);

    options.root.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        seek(currentProgress - 0.01);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        seek(currentProgress + 0.01);
      } else if (event.key === "Home") {
        event.preventDefault();
        seek(0);
      } else if (event.key === "End") {
        event.preventDefault();
        seek(1);
      }
    });
  };

  return {
    bind,
    getProgress: () => currentProgress,
    setProgress,
  };
}
