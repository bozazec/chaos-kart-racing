import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173 },
  worker: { format: "es" },
});
