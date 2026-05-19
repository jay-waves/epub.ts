const REDIRECT_RULE_ID = 1;
const EPUB_URL_REGEX = "^file:///.+\\.epub(?:[?#].*)?$";
const VIEWER_URL = chrome.runtime.getURL("viewer.html");

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

chrome.runtime.onInstalled.addListener(() => {
  void installRedirectRule();
});

chrome.runtime.onStartup.addListener(() => {
  void installRedirectRule();
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({
    url: VIEWER_URL,
  });
});
