import assert from "node:assert/strict";
import test from "node:test";

import { loadFrameDocument } from "../app/renderer/shared/frame-document.ts";

class FrameStub extends EventTarget {
  contentDocument = {} as Document;
  src = "";
}

test("frame loading settles through load and error events", async () => {
  const loadedFrame = new FrameStub();
  const loaded = loadFrameDocument(
    loadedFrame as unknown as HTMLIFrameElement,
    "book.xhtml",
    new AbortController().signal,
    () => 42,
  );
  loadedFrame.dispatchEvent(new Event("load"));
  assert.equal(await loaded, 42);

  const failedFrame = new FrameStub();
  const failed = loadFrameDocument(
    failedFrame as unknown as HTMLIFrameElement,
    "missing.xhtml",
    new AbortController().signal,
    () => undefined,
  );
  failedFrame.dispatchEvent(new Event("error"));
  await assert.rejects(failed, (error: DOMException) => error.name === "NetworkError");
});

test("aborting frame loading rejects immediately and removes load work", async () => {
  const frame = new FrameStub();
  const controller = new AbortController();
  const reason = new DOMException("Frame owner destroyed", "AbortError");
  let called = false;
  const loading = loadFrameDocument(
    frame as unknown as HTMLIFrameElement,
    "book.xhtml",
    controller.signal,
    () => { called = true; },
  );

  controller.abort(reason);
  await assert.rejects(loading, (error) => error === reason);
  frame.dispatchEvent(new Event("load"));
  assert.equal(called, false);
});
