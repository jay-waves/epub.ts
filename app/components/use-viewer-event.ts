import { useEffect, useLayoutEffect, useRef } from "react";
import { listenViewerEvent } from "../viewer-events";
import type { ViewerEventDetailMap } from "../viewer-events";

export function useViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  handler: (detail: ViewerEventDetailMap[EventName]) => void,
) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(
    () => listenViewerEvent(eventName, (detail) => handlerRef.current(detail)),
    [eventName],
  );
}
