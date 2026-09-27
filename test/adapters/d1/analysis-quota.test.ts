import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1AnalysisQuota } from "../../../src/adapters/d1/analysis-quota";
import type { NewAnalysisJob } from "../../../src/domain/entities";
import { asTeamId } from "../../../src/domain/ids";

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

function newJob(
  overrides: Partial<Omit<NewAnalysisJob, "teamId">> & { id: string; teamId: string },
): NewAnalysisJob {
  const { teamId, ...rest } = overrides;
  return {
    chatId: 1,
    threadId: null,
    utcDay: "2026-01-01",
    fetchUrl: "https://example.com/hack",
    createdAt: 1000,
    ...rest,
    teamId: asTeamId(teamId),
  };
}

async function jobRow(id: string) {
  return env.DB.prepare("SELECT * FROM hackathon_analysis_jobs WHERE id = ?")
    .bind(id)
    .first<{ status: string; team_id: string; fetch_url: string }>();
}

async function usageRow(teamId: string, day: string) {
  return env.DB.prepare(
    "SELECT runs, lease_until, lease_job_id FROM hackathon_analysis_usage WHERE team_id = ? AND utc_day = ?",
  )
    .bind(teamId, day)
    .first<{ runs: number; lease_until: number; lease_job_id: string | null }>();
}

describe("createD1AnalysisQuota", () => {
  it("reserve returns ok, inserts the queued job row, and sets runs/lease atomically on a fresh day", async () => {
    await seedTeam("team-q-fresh", 1000);
    const quota = createD1AnalysisQuota(env.DB);

    const result = await quota.reserve({
      team: asTeamId("team-q-fresh"),
      day: "2026-01-01",
      cap: 5,
      now: 1_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-fresh-1", teamId: "team-q-fresh" }),
    });

    expect(result).toBe("ok");
    const usage = await usageRow("team-q-fresh", "2026-01-01");
    expect(usage?.runs).toBe(1);
    expect(usage?.lease_until).toBe(1_000_000 + 900_000);
    expect(usage?.lease_job_id).toBe("job-fresh-1");
    const job = await jobRow("job-fresh-1");
    expect(job?.status).toBe("queued");
    expect(job?.team_id).toBe("team-q-fresh");
  });

  it("reserve increments runs and moves the lease to the new job on a second reservation once the prior lease expired", async () => {
    await seedTeam("team-q-second", 1001);
    const quota = createD1AnalysisQuota(env.DB);
    await quota.reserve({
      team: asTeamId("team-q-second"),
      day: "2026-01-01",
      cap: 5,
      now: 1_000_000,
      leaseMs: 100, // expires almost immediately
      job: newJob({ id: "job-second-1", teamId: "team-q-second" }),
    });

    const result = await quota.reserve({
      team: asTeamId("team-q-second"),
      day: "2026-01-01",
      cap: 5,
      now: 2_000_000, // well past the first lease's expiry
      leaseMs: 900_000,
      job: newJob({ id: "job-second-2", teamId: "team-q-second" }),
    });

    expect(result).toBe("ok");
    const usage = await usageRow("team-q-second", "2026-01-01");
    expect(usage?.runs).toBe(2);
    expect(usage?.lease_job_id).toBe("job-second-2");
    expect(await jobRow("job-second-2")).not.toBeNull();
  });

  it("reserve returns busy and inserts no job row while the lease is still held", async () => {
    await seedTeam("team-q-busy", 1002);
    const quota = createD1AnalysisQuota(env.DB);
    await quota.reserve({
      team: asTeamId("team-q-busy"),
      day: "2026-01-01",
      cap: 5,
      now: 1_000_000,
      leaseMs: 900_000, // still active for the second call below
      job: newJob({ id: "job-busy-1", teamId: "team-q-busy" }),
    });

    const result = await quota.reserve({
      team: asTeamId("team-q-busy"),
      day: "2026-01-01",
      cap: 5,
      now: 1_500_000, // before the first lease's expiry (1_000_000 + 900_000)
      leaseMs: 900_000,
      job: newJob({ id: "job-busy-2", teamId: "team-q-busy" }),
    });

    expect(result).toBe("busy");
    const usage = await usageRow("team-q-busy", "2026-01-01");
    expect(usage?.runs).toBe(1);
    expect(usage?.lease_job_id).toBe("job-busy-1");
    expect(await jobRow("job-busy-2")).toBeNull();
  });

  it("reserve returns cap-reached and inserts no job row once the daily cap is hit, even with an expired lease", async () => {
    await seedTeam("team-q-cap", 1003);
    const quota = createD1AnalysisQuota(env.DB);
    // Two reservations at cap=2, each releasing its lease so the next one is
    // never "busy" — proves cap-reached is reported once runs hits the cap.
    for (const id of ["job-cap-1", "job-cap-2"]) {
      await quota.reserve({
        team: asTeamId("team-q-cap"),
        day: "2026-01-01",
        cap: 2,
        now: 1_000_000,
        leaseMs: 1,
        job: newJob({ id, teamId: "team-q-cap" }),
      });
      await quota.release(asTeamId("team-q-cap"), "2026-01-01", id, false);
    }

    const result = await quota.reserve({
      team: asTeamId("team-q-cap"),
      day: "2026-01-01",
      cap: 2,
      now: 2_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-cap-3", teamId: "team-q-cap" }),
    });

    expect(result).toBe("cap-reached");
    const usage = await usageRow("team-q-cap", "2026-01-01");
    expect(usage?.runs).toBe(2);
    expect(await jobRow("job-cap-3")).toBeNull();
  });

  it("reserve is tenant-scoped: two teams get independent usage rows for the same day", async () => {
    await seedTeam("team-q-iso-a", 1004);
    await seedTeam("team-q-iso-b", 1005);
    const quota = createD1AnalysisQuota(env.DB);

    await quota.reserve({
      team: asTeamId("team-q-iso-a"),
      day: "2026-01-01",
      cap: 1,
      now: 1_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-iso-a", teamId: "team-q-iso-a" }),
    });
    const result = await quota.reserve({
      team: asTeamId("team-q-iso-b"),
      day: "2026-01-01",
      cap: 1,
      now: 1_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-iso-b", teamId: "team-q-iso-b" }),
    });

    expect(result).toBe("ok");
    expect((await usageRow("team-q-iso-a", "2026-01-01"))?.runs).toBe(1);
    expect((await usageRow("team-q-iso-b", "2026-01-01"))?.runs).toBe(1);
  });

  it("release clears the lease and, when refund is set, decrements runs by exactly one", async () => {
    await seedTeam("team-q-release", 1006);
    const quota = createD1AnalysisQuota(env.DB);
    await quota.reserve({
      team: asTeamId("team-q-release"),
      day: "2026-01-01",
      cap: 5,
      now: 1_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-release-1", teamId: "team-q-release" }),
    });

    await quota.release(asTeamId("team-q-release"), "2026-01-01", "job-release-1", true);

    const usage = await usageRow("team-q-release", "2026-01-01");
    expect(usage?.runs).toBe(0);
    expect(usage?.lease_until).toBe(0);
    expect(usage?.lease_job_id).toBeNull();
  });

  it("release without refund clears the lease but leaves runs unchanged", async () => {
    await seedTeam("team-q-release-norefund", 1007);
    const quota = createD1AnalysisQuota(env.DB);
    await quota.reserve({
      team: asTeamId("team-q-release-norefund"),
      day: "2026-01-01",
      cap: 5,
      now: 1_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-norefund-1", teamId: "team-q-release-norefund" }),
    });

    await quota.release(
      asTeamId("team-q-release-norefund"),
      "2026-01-01",
      "job-norefund-1",
      false,
    );

    const usage = await usageRow("team-q-release-norefund", "2026-01-01");
    expect(usage?.runs).toBe(1);
    expect(usage?.lease_job_id).toBeNull();
  });

  it("release is owner-checked: a stale job cannot release another job's lease", async () => {
    await seedTeam("team-q-owner", 1008);
    const quota = createD1AnalysisQuota(env.DB);
    await quota.reserve({
      team: asTeamId("team-q-owner"),
      day: "2026-01-01",
      cap: 5,
      now: 1_000_000,
      leaseMs: 1,
      job: newJob({ id: "job-owner-1", teamId: "team-q-owner" }),
    });
    // Lease expires, a second job takes it over.
    await quota.reserve({
      team: asTeamId("team-q-owner"),
      day: "2026-01-01",
      cap: 5,
      now: 2_000_000,
      leaseMs: 900_000,
      job: newJob({ id: "job-owner-2", teamId: "team-q-owner" }),
    });

    // job-owner-1 (stale) tries to release: must not touch job-owner-2's lease.
    await quota.release(asTeamId("team-q-owner"), "2026-01-01", "job-owner-1", true);

    const usage = await usageRow("team-q-owner", "2026-01-01");
    expect(usage?.lease_job_id).toBe("job-owner-2");
    expect(usage?.runs).toBe(2);
  });

  it("propagates (rejects) when the D1 batch fails, instead of swallowing the error", async () => {
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
    const failingDb = {
      prepare: () => statement,
      batch: async () => {
        throw err;
      },
    } as unknown as D1Database;
    const quota = createD1AnalysisQuota(failingDb);

    await expect(
      quota.reserve({
        team: asTeamId("any-team"),
        day: "2026-01-01",
        cap: 5,
        now: 0,
        leaseMs: 1000,
        job: newJob({ id: "job-fail", teamId: "any-team" }),
      }),
    ).rejects.toThrow("D1_ERROR: simulated D1 outage");
  });
});
