import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // In dev mode, proxy /api calls to Netlify functions via netlify dev
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
  },
});
