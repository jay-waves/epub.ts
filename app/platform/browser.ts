import { platform as launcherPlatform } from "./launcher";
import { platform as webPlatform } from "./web";
import type { ViewerPlatform } from "./types";

const isLauncherDocument = Boolean(
  new URLSearchParams(window.location.search).get("launcherDocument"),
);

export const platform: ViewerPlatform = isLauncherDocument
  ? launcherPlatform
  : webPlatform;
