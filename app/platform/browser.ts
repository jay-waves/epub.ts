import { platform as docflowPlatform } from "./docflow";
import { platform as webPlatform } from "./web";
import type { ViewerPlatform } from "./types";

const isDocflowDocument = Boolean(
  new URLSearchParams(window.location.search).get("docflowDocument"),
);

export const platform: ViewerPlatform = isDocflowDocument
  ? docflowPlatform
  : webPlatform;
