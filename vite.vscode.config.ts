import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "vscode-extension/media",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "vscode-webview.html"),
    },
  },
});
