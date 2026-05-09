import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Static SPA build for GitHub Pages (custom domain prepromo.online — root path).
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
