import { defineConfig } from "vitest/config";

// Plain Node tests for now. studio-api moves to the Cloudflare Workers pool
// (local D1) when its shell lands — Phase 1, step 3.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "workers/*/src/**/*.test.ts"],
  },
});
