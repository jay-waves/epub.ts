import tailwindcss from "@tailwindcss/vite";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const requestedPlatform = process.env.VIEWER_PLATFORM;
const viewerPlatform = requestedPlatform === "web" ? "web" : "chrome";
const isWeb = viewerPlatform === "web";
const isBrowser = isWeb;
const outputDir = isBrowser ? "release/web" : "release/extension";

export default defineConfig({
  base: "./",
  publicDir: isBrowser ? false : "public",
  resolve: {
    alias: {
      "#platform": resolve(
        __dirname,
        isWeb ? "app/platform/browser.ts" : "app/platform/chrome.ts",
      ),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(isBrowser ? [{
      name: "browser-viewer-assets",
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
        cpSync(resolve(__dirname, "public/logo.svg"), resolve(resolvedOutputDir, "logo.svg"));
        for (const filename of [
          "EBGaramond-VariableFont_wght.ttf",
          "EBGaramond-Italic-VariableFont_wght.ttf",
          "Monaspace Argon Var.woff2",
        ]) {
          cpSync(resolve(__dirname, "public", filename), resolve(resolvedOutputDir, filename));
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
