import { applyD1Migrations, env } from "cloudflare:test";

// Fresh D1 per test file, with the real migrations applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
