type TraceDetails = Record<string, unknown>;

type TraceStage =
  | "document-opening"
  | "epub-download"
  | "epub-parsing"
  | "launcher-resource-check"
  | "reader-font-loading";
type TraceStatus = "started" | "completed" | "failed";

const TRACE_MESSAGES: Record<TraceStage, Record<TraceStatus, string>> = {
  "document-opening": {
    started: "Opening the EPUB document.",
    completed: "The EPUB document is ready.",
    failed: "Failed to open the EPUB document.",
  },
  "epub-download": {
    started: "Downloading the EPUB resource.",
    completed: "The EPUB resource was downloaded.",
    failed: "Failed to download the EPUB resource.",
  },
  "epub-parsing": {
    started: "Parsing the EPUB publication.",
    completed: "The EPUB publication was parsed.",
    failed: "Failed to parse the EPUB publication.",
  },
  "launcher-resource-check": {
    started: "Checking the launcher document resource.",
    completed: "The launcher document resource responded.",
    failed: "Failed to check the launcher document resource.",
  },
  "reader-font-loading": {
    started: "Loading the reader fonts.",
    completed: "The reader fonts were loaded.",
    failed: "Failed to load the reader fonts.",
  },
};

const startedAt = performance.now();
const stages = new Map<TraceStage, number>();
const loadedEpubResources = new Map<string, number>();
let active = true;

function roundMilliseconds(value: number) {
  return Math.round(value * 10) / 10;
}

function formatDetails(details: TraceDetails) {
  return Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (!key.endsWith("Bytes") || typeof value !== "number") return [[key, value]];
    return [[`${key.slice(0, -"Bytes".length)}KB`, Math.round(value / 102.4) / 10]];
  }));
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

function write(stage: TraceStage, status: TraceStatus, details: TraceDetails) {
  const now = performance.now();
  const stageStartedAt = stages.get(stage);
  const startupMs = roundMilliseconds(now - startedAt);
  const message = `[epub-ts +${startupMs.toFixed(1)}ms] ${TRACE_MESSAGES[stage][status]}`;
  const data = {
    ...(stageStartedAt === undefined || status === "started"
      ? {}
      : { durationMs: roundMilliseconds(now - stageStartedAt) }),
    ...formatDetails(details),
  };
  if (Object.keys(data).length) console.info(message, data);
  else console.info(message);
}

/** Low-frequency startup milestones and approximate application resource totals. */
export const startupTrace = {
  start(stage: TraceStage, details: TraceDetails = {}) {
    if (!active) return;
    stages.set(stage, performance.now());
    write(stage, "started", details);
  },
  complete(stage: TraceStage, details: TraceDetails = {}) {
    if (!active) return;
    write(stage, "completed", details);
    stages.delete(stage);
  },
  fail(stage: TraceStage, error: unknown, details: TraceDetails = {}) {
    if (!active) return;
    write(stage, "failed", { ...details, error });
    stages.delete(stage);
  },
  cancel(stage: TraceStage) {
    stages.delete(stage);
  },
  beginEpub() {
    if (!active) return;
    loadedEpubResources.clear();
  },
  recordEpubResource(name: string, bytes: number) {
    if (active && !loadedEpubResources.has(name)) loadedEpubResources.set(name, bytes);
  },
  epubResources() {
    return {
      epubLoadedBytes: [...loadedEpubResources.values()].reduce((total, bytes) => total + bytes, 0),
    };
  },
  fontResources(urls: readonly string[]) {
    return fontResourceDetails(urls);
  },
  finish() {
    active = false;
    stages.clear();
    loadedEpubResources.clear();
  },
};
