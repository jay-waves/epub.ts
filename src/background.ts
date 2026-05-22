const REDIRECT_RULE_ID = 1;
const EPUB_URL_REGEX = "^file:///.+\\.epub(?:[?#].*)?$";
const VIEWER_URL = chrome.runtime.getURL("viewer.html");
const STARTUP_DOWNLOAD_LOOKBACK_MS = 30_000;
const RECOVERED_DOWNLOAD_IDS_KEY = "recoveredDownloadIds";

function isEpubFileUrl(url?: string): url is string {
  return Boolean(url?.match(new RegExp(EPUB_URL_REGEX, "i")));
}

function getViewerUrl(sourceUrl: string) {
  const viewerUrl = new URL(VIEWER_URL);
  viewerUrl.searchParams.set("src", sourceUrl);
  return viewerUrl.href;
}

async function installRedirectRule() {
  const redirectUrl = `${chrome.runtime.getURL("viewer.html")}?src=\\0`;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID],
    addRules: [
      {
        id: REDIRECT_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            regexSubstitution: redirectUrl,
          },
        },
        condition: {
          regexFilter: EPUB_URL_REGEX,
          isUrlFilterCaseSensitive: false,
          resourceTypes: ["main_frame"],
        },
      },
    ],
  });
}

async function getRecoveredDownloadIds() {
  const stored = await chrome.storage.session.get(RECOVERED_DOWNLOAD_IDS_KEY);
  const ids = stored[RECOVERED_DOWNLOAD_IDS_KEY];
  return Array.isArray(ids) ? new Set<number>(ids.filter((id) => typeof id === "number")) : new Set<number>();
}

async function saveRecoveredDownloadIds(ids: Set<number>) {
  await chrome.storage.session.set({
    [RECOVERED_DOWNLOAD_IDS_KEY]: Array.from(ids).slice(-20),
  });
}

async function recoverRecentEpubDownload() {
  const since = new Date(Date.now() - STARTUP_DOWNLOAD_LOOKBACK_MS).toISOString();
  const downloads = await chrome.downloads.search({
    startedAfter: since,
    orderBy: ["-startTime"],
    limit: 10,
  });
  const recoveredIds = await getRecoveredDownloadIds();

  for (const item of downloads) {
    if (item.byExtensionId === chrome.runtime.id) continue;
    if (recoveredIds.has(item.id)) continue;

    const sourceUrl = item.finalUrl || item.url;
    if (!isEpubFileUrl(sourceUrl)) continue;

    recoveredIds.add(item.id);
    await saveRecoveredDownloadIds(recoveredIds);

    if (!item.exists || item.state === "in_progress") {
      await chrome.downloads.cancel(item.id).catch(() => undefined);
    }

    await chrome.tabs.create({
      url: getViewerUrl(sourceUrl),
    });
    return;
  }
}

async function recoverOpenEpubTabs() {
  const tabs = await chrome.tabs.query({
    url: "file:///*.epub",
  });

  for (const tab of tabs) {
    const sourceUrl = tab.url;
    if (!tab.id || !isEpubFileUrl(sourceUrl)) continue;

    await chrome.tabs.update(tab.id, {
      url: getViewerUrl(sourceUrl),
    });
  }
}

async function startup() {
  await installRedirectRule();
  await recoverOpenEpubTabs();
  await recoverRecentEpubDownload();
}

chrome.runtime.onInstalled.addListener(() => {
  void installRedirectRule();
});

chrome.runtime.onStartup.addListener(() => {
  void startup().catch((error) => {
    console.warn("Failed to run EPUB startup recovery.", error);
  });
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({
    url: VIEWER_URL,
  });
});
