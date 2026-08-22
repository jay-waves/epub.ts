import { useEffect, useLayoutEffect, useRef } from "react";
import { useStore } from "zustand";
import { isViewerStateEvent, listenViewerEvent, viewerStore } from "../../events";
import type { ViewerEventDetailMap } from "../../events";

export function useViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  handler: (detail: ViewerEventDetailMap[EventName]) => void,
) {
  const stateEvent = isViewerStateEvent(eventName);
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const update = useStore(viewerStore, (state) => stateEvent ? state.updates[eventName] : undefined);
  const revisionRef = useRef(0);
  useEffect(() => {
    if (!update || update.revision === revisionRef.current) return;
    revisionRef.current = update.revision;
    handlerRef.current(update.detail as ViewerEventDetailMap[EventName]);
  }, [update]);

  useEffect(() => {
    if (stateEvent) return;
    return listenViewerEvent(eventName, (detail) => handlerRef.current(detail));
  }, [eventName, stateEvent]);
}
