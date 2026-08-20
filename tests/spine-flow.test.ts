import assert from "node:assert/strict";
import test from "node:test";

import { SpineFlow } from "../app/renderer/shared/spine-flow.ts";
import type { Book } from "../app/renderer/reader-view.d.ts";

const hrefs = [
  "cover.xhtml",
  "copyright.xhtml",
  "chapter-1.xhtml",
  "section-1.xhtml",
  "chapter-2.xhtml",
];

const book = {
  sections: hrefs.map((id, index) => ({
    id,
    ...(index === 1 ? { linear: "no" } : {}),
  })),
  toc: [
    { href: "chapter-1.xhtml", subitems: [{ href: "section-1.xhtml" }] },
    { href: "chapter-2.xhtml" },
  ],
  resolveHref: href => ({ index: hrefs.indexOf(href.split("#")[0]!) }),
} satisfies Book;

test("only top-level TOC targets create flow boundaries", () => {
  const flow = new SpineFlow(book);
  assert.equal(flow.breakBefore(0), false);
  assert.equal(flow.breakBefore(2), true);
  assert.equal(flow.breakBefore(3), false);
  assert.equal(flow.breakBefore(4), true);
});

test("opening matter remains continuous even when it is non-linear", () => {
  const flow = new SpineFlow(book);
  assert.equal(flow.adjacent(0, 1), 1);
  assert.equal(flow.adjacent(2, -1), 1);
});
