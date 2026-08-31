import tailwindcss from "@tailwindcss/vite";
import { cpSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json";

const outputDir = "release/web";
const browserTargets = ["chrome129", "edge129", "firefox147", "safari26", "ios26"];
const builtAt = new Date().toISOString();
const iconFiles = ["icon.png", ...[16, 32, 48, 128].map((size) => `icon-${size}.png`)];
const fontFiles = [
  "EBGaramond-VariableFont_wght.ttf",
  "EBGaramond-Italic-VariableFont_wght.ttf",
  "Monaspace Argon Var.woff2",
];

export default defineConfig({
  base: "./",
  define: {
    __EPUB_TS_BUILD_TIME__: JSON.stringify(builtAt),
    __EPUB_TS_VERSION__: JSON.stringify(packageJson.version),
  },
  publicDir: false,
  resolve: {
    alias: {
      "@mathjax/src/mjs": resolve(__dirname, "node_modules/@mathjax/src/mjs"),
      "#platform": resolve(__dirname, "app/platform/browser.ts"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "viewer-assets",
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
        writeFileSync(
          resolve(resolvedOutputDir, "build-metadata.json"),
          `${JSON.stringify({ builtAt, version: packageJson.version })}\n`,
        );
        for (const filename of iconFiles) {
          cpSync(resolve(__dirname, "assets", filename), resolve(resolvedOutputDir, filename));
        }
        for (const filename of fontFiles) {
          cpSync(resolve(__dirname, "public", filename), resolve(resolvedOutputDir, filename));
        }
      },
    },
  ],
  build: {
    target: browserTargets,
    cssTarget: browserTargets,
    modulePreload: { polyfill: false },
    outDir: outputDir,
    emptyOutDir: true,
    rollupOptions: {
      input: { index: "index.html" },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@zip.js/zip.js/")) return "zip";
        },
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
