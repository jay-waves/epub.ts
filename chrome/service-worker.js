chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html'),
  });
});

const isSupportedEpubUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' && parsed.pathname.toLowerCase().endsWith('.epub');
  } catch {
    return false;
  }
};

const getDocumentUrlFromExtensionShortcut = (url) => {
  const prefix = chrome.runtime.getURL('');
  if (!url.startsWith(prefix)) return null;

  const extensionPath = url.slice(prefix.length);
  if (!extensionPath.toLowerCase().startsWith('file:///')) return null;
  return isSupportedEpubUrl(extensionPath) ? extensionPath : null;
};

const getViewerUrl = (documentUrl) =>
  chrome.runtime.getURL(`index.html?src=${encodeURIComponent(documentUrl)}`);

const redirectEpubTab = (tabId, url) => {
  const documentUrl = isSupportedEpubUrl(url)
    ? url
    : getDocumentUrlFromExtensionShortcut(url);
  if (!documentUrl) return;

  // Unlike PDF, Chrome may classify an EPUB navigation as a download before
  // tabs.onUpdated fires, especially during browser startup. We intentionally
  // accept that edge case to keep this worker stateless and aligned with the
  // simpler PDF.ts redirect path.
  chrome.tabs.update(tabId, {
    url: getViewerUrl(documentUrl),
  });
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) redirectEpubTab(tabId, changeInfo.url);
});
