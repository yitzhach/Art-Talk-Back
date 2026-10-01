import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/core", "packages/sdk", "workers/studio-api"],
  },
});
