import tailwindcss from "@tailwindcss/vite";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const requestedPlatform = process.env.VIEWER_PLATFORM;
const viewerPlatform = requestedPlatform === "web" ? "web" : "chrome";
const isWeb = viewerPlatform === "web";
const isBrowser = isWeb;
const outputDir = isBrowser ? "release/web" : "release/chrome/extension";

export default defineConfig({
  base: "./",
  publicDir: isBrowser ? false : "public",
  resolve: {
    alias: {
      "@mathjax/src/mjs": resolve(__dirname, "node_modules/@mathjax/src/mjs"),
      "#platform": resolve(
        __dirname,
        isWeb ? "app/platform/browser.ts" : "app/platform/chrome.ts",
      ),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "viewer-icon-assets",
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
        const iconDir = resolve(__dirname, "assets");
        cpSync(resolve(iconDir, "icon.png"), resolve(resolvedOutputDir, "icon.png"));
        for (const size of [16, 32, 48, 128]) {
          cpSync(resolve(iconDir, `icon-${size}.png`), resolve(resolvedOutputDir, `icon-${size}.png`));
        }
      },
    },
    ...(isBrowser ? [{
      name: "browser-viewer-fonts",
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
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
