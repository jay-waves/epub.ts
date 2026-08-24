import { platform as chromePlatform } from "./chrome";
import { platform as launcherPlatform } from "./launcher";
import { platform as webPlatform } from "./web";
import type { ViewerPlatform } from "./types";

const isLauncher = window.location.hostname === "epub.ts.localhost"
  || new URLSearchParams(window.location.search).has("launcherDocument");
const isChromeExtension = window.location.protocol === "chrome-extension:"
  && typeof globalThis.chrome?.runtime?.getURL === "function";

export const platform: ViewerPlatform = isChromeExtension
  ? chromePlatform
  : isLauncher
    ? launcherPlatform
    : webPlatform;
