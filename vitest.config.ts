import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Corpus integrity/index tests read 14,645 real rows. Bound worker contention
  // instead of weakening their assertions or extending production deadlines.
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"], clearMocks: true, maxWorkers: 2 },
});
