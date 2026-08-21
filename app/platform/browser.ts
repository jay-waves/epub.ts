import { platform as chromePlatform } from "./chrome";
import { platform as launcherPlatform } from "./launcher";
import { platform as webPlatform } from "./web";
import type { ViewerPlatform } from "./types";

const isLauncherDocument = Boolean(
  new URLSearchParams(window.location.search).get("launcherDocument"),
);
const isChromeExtension = window.location.protocol === "chrome-extension:";

export const platform: ViewerPlatform = isChromeExtension
  ? chromePlatform
  : isLauncherDocument
    ? launcherPlatform
    : webPlatform;
