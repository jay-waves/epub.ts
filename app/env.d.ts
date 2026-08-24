declare module "*.css";
declare module "*?raw" {
  const content: string;
  export default content;
}

declare const __EPUB_TS_BUILD_TIME__: string;
declare const __EPUB_TS_VERSION__: string;
