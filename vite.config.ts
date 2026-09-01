import tailwindcss from "@tailwindcss/vite";
import { cpSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };

const outputDir = "release/web";
const browserTargets = ["chrome152", "edge152", "firefox154", "safari26", "ios26"];
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
      "@mathjax/src/mjs": resolve(import.meta.dirname, "node_modules/@mathjax/src/mjs"),
      "#platform": resolve(import.meta.dirname, "app/platform/browser.ts"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "viewer-assets",
      writeBundle() {
        const resolvedOutputDir = resolve(import.meta.dirname, outputDir);
        writeFileSync(
          resolve(resolvedOutputDir, "build-metadata.json"),
          `${JSON.stringify({ builtAt, version: packageJson.version })}\n`,
        );
        for (const filename of iconFiles) {
          cpSync(resolve(import.meta.dirname, "assets", filename), resolve(resolvedOutputDir, filename));
        }
        for (const filename of fontFiles) {
          cpSync(resolve(import.meta.dirname, "public", filename), resolve(resolvedOutputDir, filename));
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "zip",
              test: /node_modules[\\/]@zip\.js[\\/]zip\.js/,
            },
          ],
        },
      },
    },
  },
});
