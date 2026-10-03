import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SIGNING_KEY: "test-signing-key",
            RESEND_API_KEY: "test-resend-key",
            ASSISTANT_KEY: "test-assistant-key",
            OWNER_EMAILS: "owner@studio-a.test,owner@studio-b.test,boot@example.test",
          },
        },
      }),
    ],
    test: { name: "studio-api", include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
  };
});
