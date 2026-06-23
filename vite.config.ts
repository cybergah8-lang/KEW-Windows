import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Kew for Windows (Electron renderer). Cybergah Group.
// base "./" so assets resolve under file:// when loaded by Electron.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
