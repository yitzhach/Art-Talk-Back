import { defineConfig } from "vitest/config";

// Real browsers against a real local studio-api. Not part of `pnpm test`:
// it needs Chromium and free ports. Run with `pnpm e2e`.
export default defineConfig({
  test: {
    name: "show-tracker-e2e",
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
