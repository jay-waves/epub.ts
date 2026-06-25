const REDIRECT_RULE_ID = 1;
const EPUB_URL_REGEX = "^file:///.+\\.epub(?:[?#].*)?$";
const EPUB_URL_PATTERN = new RegExp(EPUB_URL_REGEX, "i");
const VIEWER_URL = chrome.runtime.getURL("viewer.html");

const STARTUP_DOWNLOAD_LOOKBACK_MS = 30_000;
const RECOVERY_RETRY_DELAY_MS = 1_500;

const RECOVERED_DOWNLOAD_IDS_KEY = "recoveredDownloadIds";

let startupRecoveryPending = false;
const processedSourceUrls = new Set<string>();

function isEpubFileUrl(url?: string): url is string {
  return Boolean(url && EPUB_URL_PATTERN.test(url));
}

function getViewerUrl(sourceUrl: string) {
  const viewerUrl = new URL(VIEWER_URL);
  viewerUrl.search = `?src=${encodeURIComponent(sourceUrl)}`;
  return viewerUrl.href;
}

async function installEpubRedirectRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID],
    addRules: [{
      id: REDIRECT_RULE_ID,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: `${VIEWER_URL}?src=\\0`,
        },
      },
      condition: {
        regexFilter: EPUB_URL_REGEX,
        resourceTypes: ["main_frame"],
      },
    }],
  });
}

async function getRecoveredDownloadIds() {
  const stored = await chrome.storage.session.get(RECOVERED_DOWNLOAD_IDS_KEY);
  const ids = stored[RECOVERED_DOWNLOAD_IDS_KEY];
  return new Set(Array.isArray(ids) ? ids.filter(item => typeof item === "number") : []);
}

async function saveRecoveredDownloadIds(values: Set<number>) {
  await chrome.storage.session.set({ [RECOVERED_DOWNLOAD_IDS_KEY]: Array.from(values).slice(-20) });
}

async function recoverEpubDownload(item: chrome.downloads.DownloadItem | undefined) {
  if (!item || item.byExtensionId === chrome.runtime.id) return;
  const sourceUrl = item.finalUrl || item.url;
  if (!isEpubFileUrl(sourceUrl)) return;
  if (processedSourceUrls.has(sourceUrl)) return;
  processedSourceUrls.add(sourceUrl);
  const recoveredIds = await getRecoveredDownloadIds();
  if (recoveredIds.has(item.id)) return;
  recoveredIds.add(item.id);
  await saveRecoveredDownloadIds(recoveredIds);

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
  await installEpubRedirectRule();
  await recoverRecentEpubDownload();
}

async function startup() {
  await recoverStartupEpubState();
  setTimeout(() => { void recoverStartupEpubState().catch(() => {}); }, RECOVERY_RETRY_DELAY_MS);
}

chrome.runtime.onStartup.addListener(() => { void startup().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { void installEpubRedirectRule().catch(() => {}); });
chrome.downloads.onCreated.addListener(item => { void recoverEpubDownload(item).catch(() => {}); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: VIEWER_URL }); });
