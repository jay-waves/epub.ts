import assert from "node:assert/strict";
import test from "node:test";
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { createAnnotatedEpub } from "../app/epub/annotation.ts";

const overlay = "META-INF/epub-viewer-annotations.json";
test("saving annotations preserves book contents and replaces the previous overlay", async () => {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await writer.add("mimetype", new TextReader("application/epub+zip"), { level: 0 });
  await writer.add("chapter.xhtml", new TextReader("<p>Chapter text</p>"));
  await writer.add(overlay, new TextReader('{"highlights":[]}'));
  const source = await writer.close();
  const annotations = [{ id: "one", value: "cfi", color: "yellow", createdAt: 1, updatedAt: 1 }];
  const saved = await createAnnotatedEpub(source, annotations);
  const reader = new ZipReader(new BlobReader(saved), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    assert.equal(entries[0].filename, "mimetype");
    assert.equal(entries[0].compressionMethod, 0);
    assert.equal(entries.filter(entry => entry.filename === overlay).length, 1);
    const read = async (name: string) => {
      const entry = entries.find(entry => entry.filename === name);
      assert.ok(entry && !entry.directory);
      return entry.getData(new TextWriter());
    };
    assert.equal(await read("chapter.xhtml"), "<p>Chapter text</p>");
    assert.deepEqual(JSON.parse(await read(overlay)).highlights, annotations);
  } finally {
    await reader.close();
  }
});
