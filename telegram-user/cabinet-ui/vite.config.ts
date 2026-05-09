import { defineConfig } from "vite";

/**
 * Прокси на telegram-user API — браузер ходит только на :5173, CORS к :4050 не нужен.
 * Токен: sessionStorage + Authorization (после логина на этой же странице).
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4050", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:4050", changeOrigin: true },
    },
  },
});
