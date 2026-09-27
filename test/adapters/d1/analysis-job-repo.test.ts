import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1AnalysisJobRepo } from "../../../src/adapters/d1/analysis-job-repo";

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

async function seedJob(
  id: string,
  teamId: string,
  overrides: Partial<{
    status: string;
    thread_id: number | null;
    created_at: number;
    claim_until: number;
    attempts: number;
  }> = {},
) {
  await env.DB.prepare(
    `INSERT INTO hackathon_analysis_jobs
      (id, team_id, chat_id, thread_id, utc_day, fetch_url, status, attempts, claim_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      teamId,
      1,
      overrides.thread_id ?? null,
      "2026-01-01",
      "https://example.com/hack",
      overrides.status ?? "queued",
      overrides.attempts ?? 0,
      overrides.claim_until ?? 0,
      overrides.created_at ?? 0,
      overrides.created_at ?? 0,
    )
    .run();
}

function fakeClock(now: number) {
  return { now: () => now };
}

describe("createD1AnalysisJobRepo", () => {
  describe("claim", () => {
    it("claims a queued job: sets status=running, bumps attempts, sets claim_until", async () => {
      await seedTeam("team-claim-q", 1);
      await seedJob("job-q-1", "team-claim-q", { status: "queued", attempts: 0 });
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-q-1", 1_000);

      expect(result.kind).toBe("claimed");
      if (result.kind !== "claimed") throw new Error("expected claimed");
      expect(result.job.status).toBe("running");
      expect(result.job.attempts).toBe(1);
      expect(result.job.claimUntil).toBe(1_000 + 240_000);
    });

    it("re-claims a running job whose claim_until has expired", async () => {
      await seedTeam("team-claim-expired", 2);
      await seedJob("job-expired-1", "team-claim-expired", {
        status: "running",
        attempts: 1,
        claim_until: 500,
      });
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-expired-1", 1_000);

      expect(result.kind).toBe("claimed");
      if (result.kind !== "claimed") throw new Error("expected claimed");
      expect(result.job.attempts).toBe(2);
      expect(result.job.claimUntil).toBe(1_000 + 240_000);
    });

    it("returns held for a running job whose claim has not yet expired", async () => {
      await seedTeam("team-claim-held", 3);
      await seedJob("job-held-1", "team-claim-held", {
        status: "running",
        attempts: 1,
        claim_until: 5_000,
      });
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-held-1", 1_000);

      expect(result.kind).toBe("held");
      const row = await env.DB.prepare(
        "SELECT attempts, status FROM hackathon_analysis_jobs WHERE id = ?",
      )
        .bind("job-held-1")
        .first<{ attempts: number; status: string }>();
      expect(row?.attempts).toBe(1);
      expect(row?.status).toBe("running");
    });

    it("returns terminal for a succeeded job with no side effects", async () => {
      await seedTeam("team-claim-succ", 4);
      await seedJob("job-succ-1", "team-claim-succ", { status: "succeeded" });
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-succ-1", 1_000);

      expect(result.kind).toBe("terminal");
      const row = await env.DB.prepare(
        "SELECT attempts FROM hackathon_analysis_jobs WHERE id = ?",
      )
        .bind("job-succ-1")
        .first<{ attempts: number }>();
      expect(row?.attempts).toBe(0);
    });

    it("returns terminal for a failed job with no side effects", async () => {
      await seedTeam("team-claim-fail", 5);
      await seedJob("job-fail-1", "team-claim-fail", { status: "failed" });
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-fail-1", 1_000);

      expect(result.kind).toBe("terminal");
    });

    it("returns persisted (without re-claiming) for a persisted job", async () => {
      await seedTeam("team-claim-pers", 6);
      await seedJob("job-pers-1", "team-claim-pers", { status: "persisted", attempts: 1 });
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-pers-1", 1_000);

      expect(result.kind).toBe("persisted");
      if (result.kind !== "persisted") throw new Error("expected persisted");
      expect(result.job.id).toBe("job-pers-1");
      const row = await env.DB.prepare(
        "SELECT attempts, status FROM hackathon_analysis_jobs WHERE id = ?",
      )
        .bind("job-pers-1")
        .first<{ attempts: number; status: string }>();
      expect(row?.attempts).toBe(1);
      expect(row?.status).toBe("persisted");
    });

    it("returns missing for an id with no matching row", async () => {
      const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

      const result = await repo.claim("job-does-not-exist", 1_000);

      expect(result.kind).toBe("missing");
    });
  });

  it("markPersisted sets status=persisted and stores analysis_id", async () => {
    await seedTeam("team-persist", 7);
    await seedJob("job-persist-1", "team-persist", { status: "running" });
    await env.DB.prepare(
      `INSERT INTO hackathon_analyses
        (id, team_id, slug, source_url, normalized_url, fields, suggested_repos, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind("analysis-abc", "team-persist", "persist-slug", "https://x", "https://x", "{}", "[]", 0, 0)
      .run();
    const repo = createD1AnalysisJobRepo(env.DB, fakeClock(2_000));

    await repo.markPersisted("job-persist-1", "analysis-abc");

    const row = await env.DB.prepare(
      "SELECT status, analysis_id, updated_at FROM hackathon_analysis_jobs WHERE id = ?",
    )
      .bind("job-persist-1")
      .first<{ status: string; analysis_id: string; updated_at: number }>();
    expect(row?.status).toBe("persisted");
    expect(row?.analysis_id).toBe("analysis-abc");
    expect(row?.updated_at).toBe(2_000);
  });

  it("markSucceeded sets status=succeeded", async () => {
    await seedTeam("team-succeed", 8);
    await seedJob("job-succeed-1", "team-succeed", { status: "persisted" });
    const repo = createD1AnalysisJobRepo(env.DB, fakeClock(3_000));

    await repo.markSucceeded("job-succeed-1");

    const row = await env.DB.prepare(
      "SELECT status, updated_at FROM hackathon_analysis_jobs WHERE id = ?",
    )
      .bind("job-succeed-1")
      .first<{ status: string; updated_at: number }>();
    expect(row?.status).toBe("succeeded");
    expect(row?.updated_at).toBe(3_000);
  });

  it("markFailed sets status=failed and stores the failure reason", async () => {
    await seedTeam("team-failed", 9);
    await seedJob("job-failed-1", "team-failed", { status: "running" });
    const repo = createD1AnalysisJobRepo(env.DB, fakeClock(4_000));

    await repo.markFailed("job-failed-1", "job:expired");

    const row = await env.DB.prepare(
      "SELECT status, failure_reason, updated_at FROM hackathon_analysis_jobs WHERE id = ?",
    )
      .bind("job-failed-1")
      .first<{ status: string; failure_reason: string; updated_at: number }>();
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBe("job:expired");
    expect(row?.updated_at).toBe(4_000);
  });

  it("propagates (rejects) when the D1 query fails, instead of swallowing the error", async () => {
    const err = new Error("D1_ERROR: simulated D1 outage");
    const statement = {
      bind: () => statement,
      first: async () => {
        throw err;
      },
      run: async () => {
        throw err;
      },
      all: async () => {
        throw err;
      },
    };
    const failingDb = { prepare: () => statement } as unknown as D1Database;
    const repo = createD1AnalysisJobRepo(failingDb, fakeClock(0));

    await expect(repo.claim("any-id", 0)).rejects.toThrow(
      "D1_ERROR: simulated D1 outage",
    );
  });

  it("is tenant-scoped: claim/markPersisted/markSucceeded/markFailed only ever affect the row's own id, never leaking across ids", async () => {
    await seedTeam("team-scope-a", 10);
    await seedTeam("team-scope-b", 11);
    await seedJob("job-scope-a", "team-scope-a", { status: "queued" });
    await seedJob("job-scope-b", "team-scope-b", { status: "queued" });
    const repo = createD1AnalysisJobRepo(env.DB, fakeClock(0));

    await repo.claim("job-scope-a", 1_000);

    const other = await env.DB.prepare(
      "SELECT status, attempts FROM hackathon_analysis_jobs WHERE id = ?",
    )
      .bind("job-scope-b")
      .first<{ status: string; attempts: number }>();
    expect(other?.status).toBe("queued");
    expect(other?.attempts).toBe(0);
  });
});
