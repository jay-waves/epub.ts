import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ProgressUpdate } from "../model";
import { Slider, SliderRange, SliderThumb, SliderTrack } from "./ui";

const HISTORY_DISMISS_MS = 8_000;
const SECTION_JUMP_THRESHOLD = 2;
const SEEK_KEYS = new Set([
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp",
]);

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function ReadingProgress({ onSeek, returnRequest, update }: {
  onSeek: (progress: number) => void;
  returnRequest: number;
  update: ProgressUpdate;
}) {
  const [progress, setProgressState] = useState(0);
  const [history, setHistoryState] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const progressRef = useRef(0);
  const sectionRef = useRef<number | null>(null);
  const originRef = useRef<number | null>(null);
  const pendingHistoryRef = useRef<number | null>(null);
  const suppressJumpRef = useRef(false);
  const dismissTimerRef = useRef<number | undefined>(undefined);
  const returnRequestRef = useRef(returnRequest);

  const setProgress = (value: number) => {
    const next = clamp(value);
    progressRef.current = next;
    setProgressState(next);
  };

  const setHistory = (value: number | null) => {
    window.clearTimeout(dismissTimerRef.current);
    const next = value == null ? null : clamp(value);
    setHistoryState(next);
    if (next != null) {
      dismissTimerRef.current = window.setTimeout(() => setHistoryState(null), HISTORY_DISMISS_MS);
    }
  };

  useEffect(() => () => window.clearTimeout(dismissTimerRef.current), []);

  useEffect(() => {
    const { fraction, index, reset } = update;
    if (reset) {
      setEnabled(false);
      sectionRef.current = null;
      originRef.current = null;
      pendingHistoryRef.current = null;
      suppressJumpRef.current = false;
      setHistory(null);
      setProgress(0);
      return;
    }

    setEnabled(true);

    if (pendingHistoryRef.current != null) {
      setHistory(pendingHistoryRef.current);
      pendingHistoryRef.current = null;
    } else if (
      index != null
      && sectionRef.current != null
      && Math.abs(index - sectionRef.current) > SECTION_JUMP_THRESHOLD
      && !suppressJumpRef.current
    ) {
      setHistory(progressRef.current);
    }

    suppressJumpRef.current = false;
    sectionRef.current = index ?? null;
    setProgress(fraction);
  }, [update]);

  const seek = (value: number) => {
    const next = clamp(value);
    const origin = originRef.current ?? progressRef.current;
    originRef.current = null;
    if (Math.abs(next - origin) > 0.001) {
      pendingHistoryRef.current = origin;
      suppressJumpRef.current = true;
    }
    setProgress(next);
    onSeek(next);
  };

  const rememberOrigin = () => {
    originRef.current ??= progressRef.current;
  };

  const returnToHistory = () => {
    if (history == null) return;
    const target = history;
    pendingHistoryRef.current = null;
    suppressJumpRef.current = true;
    setHistory(null);
    setProgress(target);
    onSeek(target);
  };

  useEffect(() => {
    if (returnRequest === returnRequestRef.current) return;
    returnRequestRef.current = returnRequest;
    returnToHistory();
  }, [returnRequest]);

  const percentage = progress * 100;
  return (
    <div className="reader-progress-shell">
      <div className="reader-progress-row">
        <Slider
          aria-label="Reading progress"
          className="reader-progress"
          disabled={!enabled}
          max={100}
          min={0}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape" && history != null) {
              event.preventDefault();
              returnToHistory();
            } else if (SEEK_KEYS.has(event.key)) {
              rememberOrigin();
            }
          }}
          onPointerDown={rememberOrigin}
          onValueChange={([value = 0]) => setProgress(value / 100)}
          onValueCommit={([value = 0]) => seek(value / 100)}
          step={1}
          value={[percentage]}
        >
          <div className="reader-progress-track-wrap">
            <SliderTrack className="reader-progress-track">
              <SliderRange className="reader-progress-read" />
            </SliderTrack>
            <SliderThumb className="reader-progress-thumb" />
          </div>
        </Slider>
        <button
          aria-label="Return to previous reading position"
          aria-hidden={history == null}
          className={`reader-progress-history-marker${history == null ? "" : " is-history-visible"}`}
          disabled={history == null}
          onClick={returnToHistory}
          type="button"
        />
      </div>
    </div>
  );
}
