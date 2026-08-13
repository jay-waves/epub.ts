import { useEffect, useLayoutEffect, useRef } from "react";
import { useStore } from "zustand";
import { viewerStore } from "../viewer-events";
import type { ViewerEventDetailMap } from "../viewer-events";

export function useViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  handler: (detail: ViewerEventDetailMap[EventName]) => void,
) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const update = useStore(viewerStore, (state) => state.updates[eventName]);
  const revisionRef = useRef(0);
  useEffect(() => {
    if (!update || update.revision === revisionRef.current) return;
    revisionRef.current = update.revision;
    handlerRef.current(update.detail as ViewerEventDetailMap[EventName]);
  }, [update]);
}
