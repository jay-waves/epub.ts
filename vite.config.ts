import tailwindcss from "@tailwindcss/vite";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const viewerPlatform = process.env.VIEWER_PLATFORM === "web" ? "web" : "chrome";
const isWeb = viewerPlatform === "web";

export default defineConfig({
  base: "./",
  publicDir: isWeb ? false : "public",
  define: {
    __VIEWER_PLATFORM__: JSON.stringify(viewerPlatform),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(isWeb ? [{
      name: "web-viewer-assets",
      writeBundle() {
        const outputDir = resolve(__dirname, "release/web");
        cpSync(resolve(__dirname, "public/logo.svg"), resolve(outputDir, "logo.svg"));
      },
    }] : []),
  ],
  build: {
    outDir: isWeb ? "release/web" : "release/extension",
    emptyOutDir: true,
    rollupOptions: {
      input: isWeb
        ? { index: "index.html" }
        : { viewer: "viewer.html", background: "app/platform/chrome-background.ts" },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@zip.js/zip.js/")) return "zip";
        },
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background"
            ? "background.js"
            : isWeb ? "assets/[name]-[hash].js" : "assets/[name].js",
        chunkFileNames: isWeb ? "assets/[name]-[hash].js" : "assets/[name].js",
        assetFileNames: isWeb ? "assets/[name]-[hash][extname]" : "assets/[name][extname]",
      },
    },
  },
});
