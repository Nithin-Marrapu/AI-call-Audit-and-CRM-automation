import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the UI runs on :5173 and forwards /api to the Node server on :5050.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:5050" } }
});
