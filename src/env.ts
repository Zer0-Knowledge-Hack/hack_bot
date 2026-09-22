// Worker bindings/secrets (wrangler.jsonc `d1_databases`, and secrets set via
// `wrangler secret put` / `.dev.vars` locally — see .dev.vars.example).
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  PII_KEYRING: string;
  BOT_INFO: string;
}
