import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react(), tailwindcss()], 
  build: {
    outDir: "release/extension",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        viewer: "viewer.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background"
            ? "background.js"
            : "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
