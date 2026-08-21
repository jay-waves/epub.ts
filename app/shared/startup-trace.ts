type TraceDetails = Record<string, unknown>;
type ResourceKind = "svg" | "image" | "font" | "other";

const startedAt = performance.now();
const stages = new Map<string, number>();
const loadedEpubResources = new Map<string, { bytes: number; kind: ResourceKind }>();
let epubArchiveBytes = 0;
let epubEntryCount = 0;
let epubUncompressedBytes = 0;

function roundMilliseconds(value: number) {
  return Math.round(value * 10) / 10;
}

function resourceKind(name: string): ResourceKind {
  const path = name.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".svg")) return "svg";
  if (/\.(?:avif|bmp|gif|jpe?g|png|webp)$/u.test(path)) return "image";
  if (/\.(?:otf|ttc|ttf|woff2?)$/u.test(path)) return "font";
  return "other";
}

function sumResources(kind?: ResourceKind) {
  const resources = [...loadedEpubResources.values()].filter((resource) => !kind || resource.kind === kind);
  return {
    bytes: resources.reduce((total, resource) => total + resource.bytes, 0),
    count: resources.length,
  };
}

function fontResourceDetails(urls: readonly string[]): TraceDetails {
  const resources = urls.flatMap((url) => {
    const entry = performance.getEntriesByName(url, "resource").at(-1);
    return entry instanceof PerformanceResourceTiming ? [entry] : [];
  });
  if (!resources.length) return {};
  return {
    fontDecodedBytes: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
    fontTransferBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
  };
}

function write(stage: string, status: "started" | "completed" | "failed", details: TraceDetails) {
  const now = performance.now();
  const stageStartedAt = stages.get(stage);
  console.info("[EPUB.ts trace]", {
    stage,
    status,
    startupMs: roundMilliseconds(now - startedAt),
    ...(stageStartedAt === undefined || status === "started"
      ? {}
      : { durationMs: roundMilliseconds(now - stageStartedAt) }),
    ...details,
  });
}

/** Low-frequency startup milestones and approximate application resource totals. */
export const startupTrace = {
  start(stage: string, details: TraceDetails = {}) {
    stages.set(stage, performance.now());
    write(stage, "started", details);
  },
  complete(stage: string, details: TraceDetails = {}) {
    write(stage, "completed", details);
    stages.delete(stage);
  },
  fail(stage: string, error: unknown, details: TraceDetails = {}) {
    write(stage, "failed", { ...details, error });
    stages.delete(stage);
  },
  cancel(stage: string) {
    stages.delete(stage);
  },
  beginEpub(archiveBytes: number, entries: readonly { uncompressedSize: number }[]) {
    loadedEpubResources.clear();
    epubArchiveBytes = archiveBytes;
    epubEntryCount = entries.length;
    epubUncompressedBytes = entries.reduce((total, entry) => total + entry.uncompressedSize, 0);
  },
  recordEpubResource(name: string, bytes: number) {
    if (!loadedEpubResources.has(name)) loadedEpubResources.set(name, { bytes, kind: resourceKind(name) });
  },
  epubResources() {
    const loaded = sumResources();
    const svg = sumResources("svg");
    const images = sumResources("image");
    const fonts = sumResources("font");
    return {
      epubArchiveBytes,
      epubEntryCount,
      epubUncompressedBytes,
      epubLoadedBytes: loaded.bytes,
      epubLoadedCount: loaded.count,
      epubSvgBytes: svg.bytes,
      epubSvgCount: svg.count,
      epubImageBytes: images.bytes,
      epubImageCount: images.count,
      epubFontBytes: fonts.bytes,
      epubFontCount: fonts.count,
    };
  },
  fontResources(urls: readonly string[]) {
    return fontResourceDetails(urls);
  },
};
