import type { AnalysisJobMessage } from "./domain/entities";

// Worker bindings/secrets (wrangler.jsonc `d1_databases`, `ai`, `browser`,
// `queues.producers` and `vars`, and secrets set via `wrangler secret put` /
// `.dev.vars` locally — see .dev.vars.example).
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  PII_KEYRING: string;
  BOT_INFO: string;
  // GitHub webhook HMAC secret (design.md "Secret scope" — one global
  // secret). Missing/empty is a config error, never a default (see
  // src/adapters/github/signature.ts).
  GITHUB_WEBHOOK_SECRET: string;
  // Hackathon analysis (design.md "File Changes"). `AI` is typed as the
  // structural subset the extractor adapter calls, so tests inject plain
  // fakes; the generated `Ai` binding satisfies it.
  AI: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
  // Browser Rendering binding, handed opaquely to `puppeteer.launch`.
  BROWSER: BrowserRun;
  // Producer side of the `hackathon-analysis` queue (`/hackathon <url>`).
  HACKATHON_QUEUE: Queue<AnalysisJobMessage>;
  // Workers AI catalog IDs for the primary and fallback extraction models
  // (validated by the extractor; empty means "not configured").
  HACKATHON_MODEL_PRIMARY: string;
  HACKATHON_MODEL_FALLBACK: string;
}
