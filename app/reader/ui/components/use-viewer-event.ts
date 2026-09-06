import { useLayoutEffect, useRef } from "react";
import { listenViewerEvent } from "../../events";
import type { ViewerEventDetailMap } from "../../events";

export function useViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  handler: (detail: ViewerEventDetailMap[EventName]) => void,
) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useLayoutEffect(() => {
    return listenViewerEvent(eventName, (detail) => handlerRef.current(detail));
  }, [eventName]);
}
