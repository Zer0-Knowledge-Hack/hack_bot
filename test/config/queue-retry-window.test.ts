import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wranglerRaw from "../../wrangler.jsonc?raw";
import { CLAIM_MS, createD1AnalysisJobRepo } from "../../src/adapters/d1/analysis-job-repo";
import { HELD_RETRY_DELAY_S } from "../../src/domain/usecases/run-hackathon-job";

// wrangler.jsonc allows full-line // comments only in this file.
const wrangler = JSON.parse(
  wranglerRaw
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("//"))
    .join("\n"),
) as {
  queues: {
    consumers: { queue: string; max_retries: number; retry_delay: number }[];
  };
};
const consumer = wrangler.queues.consumers.find((c) => c.queue === "hackathon-analysis")!;

// R4-001: a delivery can die before it acks (isolate kill, wall-time limit).
// The platform redelivers after `retry_delay`; every redelivery that still
// sees the claim `held` retries after HELD_RETRY_DELAY_S. With no DLQ, the
// LAST redelivery must land after the claim lease expires, or the job stays
// `running` forever (no reply, no refund, no markFailed).
describe("hackathon-analysis queue retry window (R4-001)", () => {
  it("wrangler consumer exists with the expected shape", () => {
    expect(consumer).toBeDefined();
  });

  it("redelivery window exceeds the claim lease", () => {
    const windowMs =
      (consumer.retry_delay + (consumer.max_retries - 1) * HELD_RETRY_DELAY_S) * 1_000;
    expect(windowMs).toBeGreaterThan(CLAIM_MS);
  });

  it("a crashed claim is held until the last redelivery, which re-claims it", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-retry-window", 991, 0)
      .run();
    await env.DB.prepare(
      `INSERT INTO hackathon_analysis_jobs
        (id, team_id, chat_id, thread_id, utc_day, fetch_url, status, attempts, claim_until, created_at, updated_at)
       VALUES (?, ?, 1, NULL, '2026-01-01', 'https://example.com/hack', 'queued', 0, 0, 0, 0)`,
    )
      .bind("job-retry-window", "team-retry-window")
      .run();

    const c = 1_000_000;
    const first = await createD1AnalysisJobRepo(env.DB, { now: () => c }).claim("job-retry-window", c);
    expect(first.kind).toBe("claimed");
    // Delivery 1 dies here. Redeliveries follow the real cadence.
    let t = c;
    const kinds: string[] = [];
    for (let i = 0; i < consumer.max_retries; i++) {
      t += (i === 0 ? consumer.retry_delay : HELD_RETRY_DELAY_S) * 1_000;
      const r = await createD1AnalysisJobRepo(env.DB, { now: () => t }).claim("job-retry-window", t);
      kinds.push(r.kind);
    }
    expect(kinds).toEqual(["held", "held", "held", "held", "claimed"]);
  });
});
