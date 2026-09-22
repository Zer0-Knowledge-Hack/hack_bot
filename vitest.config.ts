import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return {
    test: {
      setupFiles: ["./test/setup/apply-migrations.ts"],
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Test-only values, never real secrets. Mirrors
            // .dev.vars.example's documented shapes.
            BOT_TOKEN: "000000000:TEST-TOKEN-NOT-REAL",
            WEBHOOK_SECRET: "test-webhook-secret-value",
            PII_KEYRING: JSON.stringify({
              active: 1,
              keys: { "1": Buffer.alloc(32, 9).toString("base64") },
            }),
            BOT_INFO: JSON.stringify({
              id: 1,
              is_bot: true,
              first_name: "TestBot",
              username: "test_bot",
              can_join_groups: true,
              can_read_all_group_messages: false,
              supports_inline_queries: false,
              can_connect_to_business: false,
              has_main_web_app: false,
            }),
          },
        },
      }),
    ],
  };
});
