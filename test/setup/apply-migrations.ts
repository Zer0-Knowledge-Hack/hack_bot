import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Runs once per worker instance before any test file. `TEST_MIGRATIONS` is
// injected by vitest.config.ts (readD1Migrations, Node-side) since the
// Workers runtime has no filesystem access to read migrations/*.sql itself.
const migrations = (
  env as unknown as { TEST_MIGRATIONS: D1Migration[] }
).TEST_MIGRATIONS;

await applyD1Migrations(env.DB, migrations);
