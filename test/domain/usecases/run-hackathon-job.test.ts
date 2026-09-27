import { describe, expect, it } from "vitest";
import { runHackathonJob } from "../../../src/domain/usecases/run-hackathon-job";
import { UnsafeUrlError } from "../../../src/domain/errors";
import { asTeamId } from "../../../src/domain/ids";
import type { AnalysisJob, AnalysisJobMessage } from "../../../src/domain/entities";
import {
  fakeAnalysisJobRepo,
  fakeAnalysisQuota,
  fakeChatPublisher,
  fakeClock,
  fakeHackathonAnalysisRepo,
  fakeIdGen,
  fakeLlmExtractor,
  fakeLogger,
  fakePageFetcher,
  fakeRepoTopicLinkRepo,
} from "../../fakes";

const teamId = asTeamId("team-1");

function baseJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: "job-1",
    teamId,
    chatId: 111,
    threadId: null,
    utcDay: "2024-01-01",
    fetchUrl: "https://example.com/event",
    status: "running",
    attempts: 1,
    claimUntil: 0,
    analysisId: null,
    failureReason: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function baseMsg(overrides: Partial<AnalysisJobMessage> = {}): AnalysisJobMessage {
  return {
    v: 1,
    jobId: "job-1",
    teamId,
    chatId: 111,
    threadId: null,
    fetchUrl: "https://example.com/event",
    ...overrides,
  };
}

function makeDeps() {
  return {
    analysisJobRepo: fakeAnalysisJobRepo(),
    analysisQuota: fakeAnalysisQuota(),
    chatPublisher: fakeChatPublisher(),
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    staticFetcher: fakePageFetcher([{ text: "x".repeat(900) }]),
    renderedFetcher: fakePageFetcher([{ text: "" }]),
    llmExtractor: fakeLlmExtractor([
      {
        raw: {
          name: { value: "Meridian", snippet: "", confidence: 0.9 },
          format: null,
          location: null,
          teamSize: null,
          submissionDeadline: null,
          startDate: null,
          endDate: null,
          resultsDate: null,
          prizes: null,
          tracks: null,
          eligibility: null,
        },
      },
    ]),
    clock: fakeClock(1_700_000_000_000),
    idGen: fakeIdGen(),
    logger: fakeLogger(),
    primaryModel: "@cf/primary",
    fallbackModel: "@cf/fallback",
  };
}

describe("runHackathonJob", () => {
  it("terminal claim: no-op ack (spec: Duplicate delivery)", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "terminal" } });

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.staticFetcher.calls).toHaveLength(0);
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });

  it("held claim: retries", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "held" } });

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "retry", delaySeconds: 60 });
  });

  it("persisted claim: only posts, does not re-fetch or re-call the LLM", async () => {
    const deps = makeDeps();
    const job = baseJob({ status: "persisted", analysisId: "analysis-1" });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "persisted", job } });
    await deps.hackathonAnalysisRepo.save({
      id: "analysis-1",
      teamId,
      slug: "meridian",
      sourceUrl: job.fetchUrl,
      normalizedUrl: "https://example.com/event",
      fields: {
        name: { value: "Meridian", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.staticFetcher.calls).toHaveLength(0);
    expect(deps.llmExtractor.calls).toHaveLength(0);
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]!.text).toContain("meridian");
    expect(deps.analysisJobRepo.succeeded).toEqual(["job-1"]);
    expect(deps.analysisQuota.released).toEqual([
      { team: teamId, day: job.utcDay, jobId: job.id, refund: false },
    ]);
  });

  // RELI-001/RESI-002: a persisted job redelivered with a threadId must
  // link and pin, not silently bare-post (which would drop the topic link).
  it("persisted claim with a threadId: links and pins instead of a bare post (RELI-001/RESI-002)", async () => {
    const deps = makeDeps();
    const job = baseJob({ status: "persisted", analysisId: "analysis-1", threadId: 500 });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "persisted", job } });
    await deps.hackathonAnalysisRepo.save({
      id: "analysis-1",
      teamId,
      slug: "meridian",
      sourceUrl: job.fetchUrl,
      normalizedUrl: "https://example.com/event",
      fields: {
        name: { value: "Meridian", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });

    const outcome = await runHackathonJob(baseMsg({ threadId: 500 }), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]).toMatchObject({ chatId: job.chatId, threadId: 500 });
    expect(deps.chatPublisher.pinned).toHaveLength(1);
    const saved = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "analysis-1");
    expect(saved?.threadId).toBe(500);
    expect(saved?.pinnedMessageId).not.toBeNull();
    expect(deps.analysisJobRepo.succeeded).toEqual(["job-1"]);
  });

  // RELI-001/RESI-002: re-running the persisted link for an analysis
  // already linked to that exact topic must not self-unpin or self-unlink.
  it("persisted claim redelivered for an analysis already linked to that topic: does not unpin or unlink itself (RELI-001/RESI-002)", async () => {
    const deps = makeDeps();
    const job = baseJob({ status: "persisted", analysisId: "analysis-1", threadId: 500 });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "persisted", job } });
    await deps.hackathonAnalysisRepo.save({
      id: "analysis-1",
      teamId,
      slug: "meridian",
      sourceUrl: job.fetchUrl,
      normalizedUrl: "https://example.com/event",
      fields: {
        name: { value: "Meridian", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      // Already linked and pinned to the SAME topic this redelivery targets.
      threadId: 500,
      pinnedMessageId: 900,
      createdAt: 0,
      updatedAt: 0,
    });

    const outcome = await runHackathonJob(baseMsg({ threadId: 500 }), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.chatPublisher.unpinned).toHaveLength(0);
    const saved = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "analysis-1");
    expect(saved?.threadId).toBe(500);
    expect(saved?.pinnedMessageId).not.toBeNull();
  });

  // RESI-001: a persisted job's post/link step must never throw out of
  // runHackathonJob; failures route through the same transient-retry /
  // final-failure path runClaimedJob uses.
  it("persisted claim: a transient post failure retries, then fails on the final attempt (RESI-001)", async () => {
    const depsRetry = makeDeps();
    const job = baseJob({ status: "persisted", analysisId: "analysis-1" });
    depsRetry.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "persisted", job } });
    await depsRetry.hackathonAnalysisRepo.save({
      id: "analysis-1",
      teamId,
      slug: "meridian",
      sourceUrl: job.fetchUrl,
      normalizedUrl: "https://example.com/event",
      fields: {
        name: { value: "Meridian", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    depsRetry.chatPublisher.post = async () => {
      throw new Error("Telegram unavailable");
    };

    const retryOutcome = await runHackathonJob(baseMsg(), 1, depsRetry);
    expect(retryOutcome).toEqual({ kind: "retry", delaySeconds: 30 });
    expect(depsRetry.analysisJobRepo.failed).toHaveLength(0);
    expect(depsRetry.analysisJobRepo.succeeded).toHaveLength(0);

    const depsFinal = makeDeps();
    depsFinal.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "persisted", job } });
    await depsFinal.hackathonAnalysisRepo.save({
      id: "analysis-1",
      teamId,
      slug: "meridian",
      sourceUrl: job.fetchUrl,
      normalizedUrl: "https://example.com/event",
      fields: {
        name: { value: "Meridian", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    depsFinal.chatPublisher.post = async () => {
      throw new Error("Telegram unavailable");
    };

    const finalOutcome = await runHackathonJob(baseMsg(), 3, depsFinal);
    expect(finalOutcome).toEqual({ kind: "ack" });
    expect(depsFinal.analysisJobRepo.failed).toHaveLength(1);
    expect(depsFinal.analysisJobRepo.failed[0]!.reason).toContain("job:transient:");
    expect(depsFinal.analysisQuota.released).toEqual([
      { team: teamId, day: job.utcDay, jobId: job.id, refund: false },
    ]);
  });

  it("persisted claim with a missing analysis: posts a failure reply and does not mark succeeded (RELI-002)", async () => {
    const deps = makeDeps();
    const job = baseJob({ status: "persisted", analysisId: "analysis-missing" });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "persisted", job } });
    // Deliberately no matching row in hackathonAnalysisRepo for "analysis-missing".

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]!.text).toContain("could not be found");
    expect(deps.analysisJobRepo.succeeded).toEqual([]);
    expect(deps.analysisJobRepo.failed).toEqual([
      { id: "job-1", reason: "job:missing-analysis" },
    ]);
    expect(deps.analysisQuota.released).toEqual([
      { team: teamId, day: job.utcDay, jobId: job.id, refund: false },
    ]);
  });

  it("stale job (queued past 1h): refunded and expired without fetching", async () => {
    const deps = makeDeps();
    const job = baseJob({ attempts: 1, createdAt: deps.clock.now() - 61 * 60 * 1000 });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.staticFetcher.calls).toHaveLength(0);
    expect(deps.analysisJobRepo.failed).toEqual([{ id: "job-1", reason: "job:expired" }]);
    expect(deps.analysisQuota.released).toEqual([
      { team: teamId, day: job.utcDay, jobId: job.id, refund: true },
    ]);
    expect(deps.chatPublisher.posted[0]!.text).toContain("expired");
  });

  it("claimed job: runs the pipeline, persists, posts, and succeeds", async () => {
    const deps = makeDeps();
    const job = baseJob();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.analysisJobRepo.persisted).toHaveLength(1);
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.analysisJobRepo.succeeded).toEqual(["job-1"]);
    expect(deps.analysisQuota.released).toEqual([
      { team: teamId, day: job.utcDay, jobId: job.id, refund: false },
    ]);
  });

  // task 4.6 / design.md "Pin Behavior": a fresh run inside a topic links
  // and pins from the consumer instead of a bare post (RELI-003).
  it("claimed job inside a topic: links and pins instead of a bare post", async () => {
    const deps = makeDeps();
    const job = baseJob({ threadId: 500 });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });

    const outcome = await runHackathonJob(
      baseMsg({ threadId: 500 }),
      1,
      deps,
    );

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]).toMatchObject({ chatId: job.chatId, threadId: 500 });
    expect(deps.chatPublisher.pinned).toHaveLength(1);
    const saved = deps.hackathonAnalysisRepo.rows.find(
      (r) => r.id === deps.analysisJobRepo.persisted[0]?.analysisId,
    );
    expect(saved?.threadId).toBe(500);
    expect(saved?.pinnedMessageId).not.toBeNull();
    expect(deps.analysisJobRepo.succeeded).toEqual(["job-1"]);
  });

  it("transient failure: retries then fails on the final attempt (spec: Transient failure exhausts retries)", async () => {
    const depsRetry = makeDeps();
    const job = baseJob();
    depsRetry.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });
    depsRetry.staticFetcher = fakePageFetcher([{ throws: new Error("D1 unavailable") }]);

    const retryOutcome = await runHackathonJob(baseMsg(), 1, depsRetry);
    expect(retryOutcome).toEqual({ kind: "retry", delaySeconds: 30 });
    expect(depsRetry.analysisJobRepo.failed).toHaveLength(0);

    const depsFinal = makeDeps();
    depsFinal.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });
    depsFinal.staticFetcher = fakePageFetcher([{ throws: new Error("D1 unavailable") }]);

    const finalOutcome = await runHackathonJob(baseMsg(), 3, depsFinal);
    expect(finalOutcome).toEqual({ kind: "ack" });
    expect(depsFinal.analysisJobRepo.failed).toHaveLength(1);
    expect(depsFinal.analysisJobRepo.failed[0]!.reason).toContain("job:transient:");
    expect(depsFinal.analysisQuota.released).toEqual([
      { team: teamId, day: job.utcDay, jobId: job.id, refund: false },
    ]);
    expect(depsFinal.chatPublisher.posted[0]!.text).toContain("temporary error");
  });

  it("stale job: posts the expiry reply before marking failed, never silently (RESI-001, design.md 'Post then mark')", async () => {
    const deps = makeDeps();
    const job = baseJob({ attempts: 1, createdAt: deps.clock.now() - 61 * 60 * 1000 });
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });
    deps.analysisJobRepo.markFailed = async () => {
      throw new Error("D1 unavailable after post");
    };

    await expect(runHackathonJob(baseMsg(), 1, deps)).rejects.toThrow(
      "D1 unavailable after post",
    );

    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]!.text).toContain("expired");
  });

  it("permanent failure: posts the failure reply before marking failed, never silently (RESI-001, design.md 'Post then mark')", async () => {
    const deps = makeDeps();
    const job = baseJob();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });
    deps.staticFetcher = fakePageFetcher([{ throws: new UnsafeUrlError("blocked", "private-ip") }]);
    deps.analysisJobRepo.markFailed = async () => {
      throw new Error("D1 unavailable after post");
    };

    await expect(runHackathonJob(baseMsg(), 1, deps)).rejects.toThrow(
      "D1 unavailable after post",
    );

    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]!.text).toContain("public http(s)");
  });

  it("a failure reply that cannot be sent is logged, and the job is still acked and failed (FIXV-001)", async () => {
    const deps = makeDeps();
    const job = baseJob();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "claimed", job } });
    deps.staticFetcher = fakePageFetcher([{ throws: new UnsafeUrlError("blocked", "private-ip") }]);
    deps.chatPublisher.post = async () => {
      throw new Error("Telegram unavailable");
    };

    const outcome = await runHackathonJob(baseMsg(), 1, deps);

    expect(outcome).toEqual({ kind: "ack" });
    expect(deps.analysisJobRepo.failed).toHaveLength(1);
    expect(deps.logger.entries).toContainEqual(
      expect.objectContaining({ event: "hackathon-job", outcome: "error", reason: "failure-reply-failed" }),
    );
  });
});
