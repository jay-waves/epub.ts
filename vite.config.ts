import tailwindcss from "@tailwindcss/vite";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const requestedPlatform = process.env.VIEWER_PLATFORM;
const viewerPlatform = requestedPlatform === "web" || requestedPlatform === "docflow"
  ? requestedPlatform
  : "chrome";
const isWeb = viewerPlatform === "web";
const isDocflow = viewerPlatform === "docflow";
const isBrowser = isWeb || isDocflow;
const outputDir = isBrowser ? `release/${viewerPlatform}` : "release/extension";

export default defineConfig({
  base: "./",
  publicDir: isBrowser ? false : "public",
  resolve: {
    alias: {
      "#platform": resolve(__dirname, `app/platform/${viewerPlatform}.ts`),
    },
  },
  define: {
    __VIEWER_PLATFORM__: JSON.stringify(viewerPlatform),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(isBrowser ? [{
      name: "browser-viewer-assets",
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
        cpSync(resolve(__dirname, "public/logo.svg"), resolve(resolvedOutputDir, "logo.svg"));
        if (isDocflow) {
          for (const filename of [
            "LXGWWenKaiLite-Regular.ttf",
            "EBGaramond-VariableFont_wght.ttf",
            "Monaspace Argon Var.ttf",
          ]) {
            cpSync(resolve(__dirname, "public", filename), resolve(resolvedOutputDir, filename));
          }
        }
      },
    }] : []),
  ],
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    rollupOptions: {
      input: isBrowser
        ? { index: "index.html" }
        : { viewer: "viewer.html", background: "app/platform/chrome-background.ts" },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@zip.js/zip.js/")) return "zip";
        },
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background"
            ? "background.js"
            : isBrowser ? "assets/[name]-[hash].js" : "assets/[name].js",
        chunkFileNames: isBrowser ? "assets/[name]-[hash].js" : "assets/[name].js",
        assetFileNames: isBrowser ? "assets/[name]-[hash][extname]" : "assets/[name][extname]",
      },
    },
  },
});
