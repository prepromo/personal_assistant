import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Static SPA build for GitHub Pages.
export default defineConfig({
  base: "/prepromo/",
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
