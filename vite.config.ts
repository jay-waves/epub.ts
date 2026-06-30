import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [
    {
      name: "trim-foliate-for-extension",
      transform(code, id) {
        if (id.endsWith("/foliate-js/view.js")) {
          return code.replace(
            `    else if (await isPDF(file)) {
        const { makePDF } = await import('./pdf.js')
        book = await makePDF(file)
    }
`,
            "",
          );
        }
        if (id.endsWith("/foliate-js/paginator.js") || id.endsWith("/foliate-js/fixed-layout.js")) {
          return code.replaceAll("allow-same-origin allow-scripts", "allow-same-origin");
        }
        if (id.endsWith("/foliate-js/epub.js")) {
          return code.replace(
            "            // replace hrefs in XML processing instructions",
            "            doc.querySelectorAll('script').forEach(el => el.remove())\n            // replace hrefs in XML processing instructions",
          );
        }
        return null;
      },
    },
    react(),
    tailwindcss(),
  ], 
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
