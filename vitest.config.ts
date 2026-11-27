import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**"],
      exclude: ["src/server.ts"],
      reporter: ["text", "html"],
    },
  },
});
