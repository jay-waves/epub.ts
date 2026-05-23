const REDIRECT_RULE_ID = 1;
const EPUB_URL_REGEX = "^file:///.+\\.epub(?:[?#].*)?$";
const VIEWER_URL = chrome.runtime.getURL("viewer.html");

const STARTUP_DOWNLOAD_LOOKBACK_MS = 30_000;
const RECOVERY_RETRY_DELAY_MS = 1_500;

const RECOVERED_DOWNLOAD_IDS_KEY = "recoveredDownloadIds";

let startupRecoveryPending = false;
let processedSourceUrls = new Set<string>();

function isEpubFileUrl(url?: string): url is string {
  return Boolean(url?.match(new RegExp(EPUB_URL_REGEX, "i")));
}

function getViewerUrl(sourceUrl: string) {
  return `${VIEWER_URL}?src=${encodeURIComponent(sourceUrl)}`;
}

async function getStoredNumberSet(key: string) {
  const stored = await chrome.storage.session.get(key);
  return new Set(Array.isArray(stored[key]) ? stored[key].filter(item => typeof item === "number") : []);
}

async function saveStoredNumberSet(key: string, values: Set<number>) {
  await chrome.storage.session.set({ [key]: Array.from(values).slice(-20) });
}

async function markUrlProcessed(sourceUrl: string) {
  if (processedSourceUrls.has(sourceUrl)) return false;
  processedSourceUrls.add(sourceUrl);
  return true;
}

async function redirectExistingEpubTab(sourceUrl: string) {
  const tabs = await chrome.tabs.query({ url: sourceUrl });
  const tab = tabs.find(candidate => typeof candidate.id === "number");
  if (!tab?.id) return false;
  if (!await markUrlProcessed(sourceUrl)) return true;
  await chrome.tabs.update(tab.id, { url: getViewerUrl(sourceUrl), active: true });
  return true;
}

async function recoverEpubDownload(item: chrome.downloads.DownloadItem | undefined) {
  if (!item || item.byExtensionId === chrome.runtime.id) return;
  const sourceUrl = item.finalUrl || item.url;
  if (!isEpubFileUrl(sourceUrl)) return;
  if (!await markUrlProcessed(sourceUrl)) return;
  const recoveredIds = await getStoredNumberSet("recoveredDownloadIds");
  if (recoveredIds.has(item.id)) return;
  recoveredIds.add(item.id);
  await saveStoredNumberSet("recoveredDownloadIds", recoveredIds);

  // 打开 viewer 页面
  await chrome.tabs.create({ url: getViewerUrl(sourceUrl) });

  try { await chrome.downloads.cancel(item.id); } catch {}
  try { await chrome.downloads.removeFile(item.id); } catch {}
  try { await chrome.downloads.erase({ id: item.id }); } catch {}
}

async function recoverRecentEpubDownload() {
  if (startupRecoveryPending) return;
  startupRecoveryPending = true;
  try {
    const downloads = await chrome.downloads.search({
      startedAfter: new Date(Date.now() - STARTUP_DOWNLOAD_LOOKBACK_MS).toISOString(),
      orderBy: ["-startTime"],
      limit: 10,
    });
    for (const item of downloads) {
      await recoverEpubDownload(item);
    }
  } finally {
    startupRecoveryPending = false;
  }
}

async function recoverStartupEpubState() {
  await recoverRecentEpubDownload();
}

async function startup() {
  await recoverStartupEpubState();
  setTimeout(() => { void recoverStartupEpubState().catch(() => {}); }, RECOVERY_RETRY_DELAY_MS);
}

chrome.runtime.onStartup.addListener(() => { void startup().catch(() => {}); });
chrome.downloads.onCreated.addListener(item => { void recoverEpubDownload(item).catch(() => {}); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: VIEWER_URL }); });
