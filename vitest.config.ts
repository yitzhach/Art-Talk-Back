import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/core", "packages/sdk", "apps/show-tracker", "workers/studio-api"],
  },
});
