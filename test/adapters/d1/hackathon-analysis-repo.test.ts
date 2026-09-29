import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1AnalysisJobRepo } from "../../../src/adapters/d1/analysis-job-repo";
import { createD1HackathonAnalysisRepo } from "../../../src/adapters/d1/hackathon-analysis-repo";
import type { ExtractedFields } from "../../../src/domain/hackathon/extraction";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import { asTeamId } from "../../../src/domain/ids";

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

const EMPTY_FIELDS: ExtractedFields = {
  name: null,
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
};

function analysis(
  overrides: Partial<Omit<HackathonAnalysis, "teamId">> & {
    id: string;
    teamId: string;
    slug: string;
  },
): HackathonAnalysis {
  const { teamId, ...rest } = overrides;
  return {
    sourceUrl: `https://example.com/${overrides.slug}`,
    normalizedUrl: `https://example.com/${overrides.slug}`,
    fields: EMPTY_FIELDS,
    suggestedRepos: [],
    threadId: null,
    pinnedMessageId: null,
    generalMessageId: null,
    createdAt: 0,
    updatedAt: 0,
    ...rest,
    teamId: asTeamId(teamId),
  };
}

describe("createD1HackathonAnalysisRepo", () => {
  it("findBySlug returns null when no analysis exists for the team/slug", async () => {
    await seedTeam("team-fbs-none", 900);
    const repo = createD1HackathonAnalysisRepo(env.DB);

    const result = await repo.findBySlug(asTeamId("team-fbs-none"), "missing");

    expect(result).toBeNull();
  });

  it("save then findBySlug/findById/findByNormalizedUrl round-trip the analysis", async () => {
    await seedTeam("team-rt-1", 901);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    const stored = analysis({
      id: "a-rt-1",
      teamId: "team-rt-1",
      slug: "meridian",
      fields: {
        ...EMPTY_FIELDS,
        name: { value: "Meridian Hacks", snippet: "Meridian", confidence: 0.9 },
      },
      suggestedRepos: ["acme/meridian"] as HackathonAnalysis["suggestedRepos"],
    });

    await repo.save(stored);

    expect(await repo.findBySlug(asTeamId("team-rt-1"), "meridian")).toEqual(stored);
    expect(await repo.findById(asTeamId("team-rt-1"), "a-rt-1")).toEqual(stored);
    expect(
      await repo.findByNormalizedUrl(asTeamId("team-rt-1"), stored.normalizedUrl),
    ).toEqual(stored);
  });

  it("save updates an existing row in place (insert-or-update by id, same-URL refresh keeps the slug)", async () => {
    await seedTeam("team-update-1", 902);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    const original = analysis({ id: "a-upd-1", teamId: "team-update-1", slug: "refresh" });
    await repo.save(original);

    const refreshed: HackathonAnalysis = {
      ...original,
      fields: {
        ...EMPTY_FIELDS,
        name: { value: "Refreshed Name", snippet: "", confidence: 1 },
      },
      updatedAt: 500,
    };
    await repo.save(refreshed);

    const rows = await repo.listByTeam(asTeamId("team-update-1"));
    expect(rows).toHaveLength(1);
    expect(await repo.findById(asTeamId("team-update-1"), "a-upd-1")).toEqual(refreshed);
  });

  it("save rejects a second row with the same (team, slug) — unique slug (task 5.2)", async () => {
    await seedTeam("team-uniq-slug", 903);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    await repo.save(
      analysis({ id: "a-slug-1", teamId: "team-uniq-slug", slug: "collide" }),
    );

    await expect(
      repo.save(
        analysis({
          id: "a-slug-2",
          teamId: "team-uniq-slug",
          slug: "collide",
          normalizedUrl: "https://example.com/different",
        }),
      ),
    ).rejects.toThrow();
  });

  it("save rejects a second row with the same (team, normalized_url) — unique URL (task 5.2)", async () => {
    await seedTeam("team-uniq-url", 904);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    await repo.save(
      analysis({
        id: "a-url-1",
        teamId: "team-uniq-url",
        slug: "one",
        normalizedUrl: "https://example.com/shared",
      }),
    );

    await expect(
      repo.save(
        analysis({
          id: "a-url-2",
          teamId: "team-uniq-url",
          slug: "two",
          normalizedUrl: "https://example.com/shared",
        }),
      ),
    ).rejects.toThrow();
  });

  it("slugExists is true only for a stored slug under that team", async () => {
    await seedTeam("team-exists-1", 905);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    await repo.save(analysis({ id: "a-exists-1", teamId: "team-exists-1", slug: "taken" }));

    expect(await repo.slugExists(asTeamId("team-exists-1"), "taken")).toBe(true);
    expect(await repo.slugExists(asTeamId("team-exists-1"), "free")).toBe(false);
  });

  it("findByThreadId returns null until a row is linked, then returns it (nullable thread_id)", async () => {
    await seedTeam("team-thread-1", 906);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    await repo.save(analysis({ id: "a-thread-1", teamId: "team-thread-1", slug: "linked" }));

    expect(await repo.findByThreadId(asTeamId("team-thread-1"), 700)).toBeNull();

    await repo.moveTopicLink(asTeamId("team-thread-1"), "a-thread-1", 700, 42);

    const found = await repo.findByThreadId(asTeamId("team-thread-1"), 700);
    expect(found?.id).toBe("a-thread-1");
    expect(found?.pinnedMessageId).toBe(42);
  });

  it("a second analysis cannot be linked to the same topic outside of moveTopicLink — unique thread_id (task 5.2)", async () => {
    await seedTeam("team-uniq-thread", 907);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    const a = analysis({ id: "a-thr-a", teamId: "team-uniq-thread", slug: "thr-a" });
    const b = analysis({
      id: "a-thr-b",
      teamId: "team-uniq-thread",
      slug: "thr-b",
      normalizedUrl: "https://example.com/thr-b",
    });
    await repo.save(a);
    await repo.save(b);
    await repo.moveTopicLink(asTeamId("team-uniq-thread"), "a-thr-a", 800, null);

    await expect(
      repo.save({ ...b, threadId: 800, pinnedMessageId: null }),
    ).rejects.toThrow();
  });

  it("listByTeam returns every stored analysis for the team, and none from another team", async () => {
    await seedTeam("team-list-a", 908);
    await seedTeam("team-list-b", 909);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    await repo.save(analysis({ id: "a-list-1", teamId: "team-list-a", slug: "one" }));
    await repo.save(analysis({ id: "a-list-2", teamId: "team-list-a", slug: "two" }));
    await repo.save(analysis({ id: "a-list-3", teamId: "team-list-b", slug: "three" }));

    const result = await repo.listByTeam(asTeamId("team-list-a"));

    expect(result.map((r) => r.id).sort()).toEqual(["a-list-1", "a-list-2"]);
  });

  describe("moveTopicLink (task 5.3a)", () => {
    it("links an analysis into an empty topic", async () => {
      await seedTeam("team-move-empty", 910);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: "a-move-1", teamId: "team-move-empty", slug: "move-1" }));

      await repo.moveTopicLink(asTeamId("team-move-empty"), "a-move-1", 1000, 55);

      const stored = await repo.findById(asTeamId("team-move-empty"), "a-move-1");
      expect(stored?.threadId).toBe(1000);
      expect(stored?.pinnedMessageId).toBe(55);
    });

    it("clears the displaced analysis's link in the same atomic batch when moving another analysis in", async () => {
      await seedTeam("team-move-displace", 911);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(
        analysis({ id: "a-old", teamId: "team-move-displace", slug: "old" }),
      );
      await repo.save(
        analysis({
          id: "a-new",
          teamId: "team-move-displace",
          slug: "new",
          normalizedUrl: "https://example.com/new",
        }),
      );
      await repo.moveTopicLink(asTeamId("team-move-displace"), "a-old", 2000, 10);

      await repo.moveTopicLink(asTeamId("team-move-displace"), "a-new", 2000, 20);

      const old = await repo.findById(asTeamId("team-move-displace"), "a-old");
      const created = await repo.findById(asTeamId("team-move-displace"), "a-new");
      expect(old?.threadId).toBeNull();
      expect(old?.pinnedMessageId).toBeNull();
      expect(created?.threadId).toBe(2000);
      expect(created?.pinnedMessageId).toBe(20);
    });

    it("moving the same analysis to a new topic clears its own old link (no self-conflict)", async () => {
      await seedTeam("team-move-self", 912);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: "a-self", teamId: "team-move-self", slug: "self" }));
      await repo.moveTopicLink(asTeamId("team-move-self"), "a-self", 3000, 5);

      await repo.moveTopicLink(asTeamId("team-move-self"), "a-self", 4000, 6);

      const stored = await repo.findById(asTeamId("team-move-self"), "a-self");
      expect(stored?.threadId).toBe(4000);
      expect(stored?.pinnedMessageId).toBe(6);
      expect(await repo.findByThreadId(asTeamId("team-move-self"), 3000)).toBeNull();
    });

    it("is idempotent for the same analysis re-linked to the same topic", async () => {
      await seedTeam("team-move-idem", 913);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: "a-idem", teamId: "team-move-idem", slug: "idem" }));
      await repo.moveTopicLink(asTeamId("team-move-idem"), "a-idem", 5000, 7);

      await repo.moveTopicLink(asTeamId("team-move-idem"), "a-idem", 5000, 7);

      const stored = await repo.findById(asTeamId("team-move-idem"), "a-idem");
      expect(stored?.threadId).toBe(5000);
      expect(stored?.pinnedMessageId).toBe(7);
    });

    it("is tenant-scoped: it never clears or reads another team's link at the same thread_id", async () => {
      await seedTeam("team-move-owner", 914);
      await seedTeam("team-move-other", 915);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: "a-owner", teamId: "team-move-owner", slug: "owner" }));
      await repo.save(
        analysis({
          id: "a-other",
          teamId: "team-move-other",
          slug: "other",
          normalizedUrl: "https://example.com/other",
        }),
      );
      await repo.moveTopicLink(asTeamId("team-move-owner"), "a-owner", 6000, 1);

      await repo.moveTopicLink(asTeamId("team-move-other"), "a-other", 6000, 2);

      const owner = await repo.findById(asTeamId("team-move-owner"), "a-owner");
      const other = await repo.findById(asTeamId("team-move-other"), "a-other");
      expect(owner?.threadId).toBe(6000);
      expect(owner?.pinnedMessageId).toBe(1);
      expect(other?.threadId).toBe(6000);
      expect(other?.pinnedMessageId).toBe(2);
    });
  });

  describe("claimTopicCreation / releaseTopicClaim (participation claim, CAS)", () => {
    const TTL = 60_000;

    async function seedAnalysis(
      teamId: string,
      chatId: number,
      threadId: number | null = null,
    ) {
      await seedTeam(teamId, chatId);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: `a-${teamId}`, teamId, slug: "claim", threadId }));
      return repo;
    }

    it("wins when the analysis has no topic (expected null) and stamps the claim", async () => {
      const repo = await seedAnalysis("team-claim-null", 920);

      const won = await repo.claimTopicCreation(asTeamId("team-claim-null"), "a-team-claim-null", null, 1_000, TTL);

      const row = await env.DB.prepare("SELECT topic_claim_until FROM hackathon_analyses WHERE id = ?")
        .bind("a-team-claim-null")
        .first<{ topic_claim_until: number }>();
      expect(won).toBe(true);
      expect(row?.topic_claim_until).toBe(1_000 + TTL);
    });

    it("wins on the observed stale thread id (expected = stale)", async () => {
      const repo = await seedAnalysis("team-claim-stale", 921, 77);

      const won = await repo.claimTopicCreation(asTeamId("team-claim-stale"), "a-team-claim-stale", 77, 1_000, TTL);

      expect(won).toBe(true);
    });

    it("loses when the observed thread id no longer matches (another tap already linked a topic)", async () => {
      const repo = await seedAnalysis("team-claim-moved", 922, 88);

      expect(await repo.claimTopicCreation(asTeamId("team-claim-moved"), "a-team-claim-moved", null, 1_000, TTL)).toBe(false);
      expect(await repo.claimTopicCreation(asTeamId("team-claim-moved"), "a-team-claim-moved", 77, 1_000, TTL)).toBe(false);
    });

    it("loses while another claim is live, and wins once the TTL has expired", async () => {
      const repo = await seedAnalysis("team-claim-ttl", 923);
      const team = asTeamId("team-claim-ttl");
      expect(await repo.claimTopicCreation(team, "a-team-claim-ttl", null, 1_000, TTL)).toBe(true);

      expect(await repo.claimTopicCreation(team, "a-team-claim-ttl", null, 1_000 + TTL - 1, TTL)).toBe(false);
      expect(await repo.claimTopicCreation(team, "a-team-claim-ttl", null, 1_000 + TTL, TTL)).toBe(true);
    });

    it("lets exactly one of two racing claims win", async () => {
      const repo = await seedAnalysis("team-claim-race", 924);
      const team = asTeamId("team-claim-race");

      const results = await Promise.all([
        repo.claimTopicCreation(team, "a-team-claim-race", null, 5_000, TTL),
        repo.claimTopicCreation(team, "a-team-claim-race", null, 5_000, TTL),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("is tenant-scoped: another team's claim call never wins on the row", async () => {
      const repo = await seedAnalysis("team-claim-owner", 925);
      await seedTeam("team-claim-intruder", 926);

      expect(await repo.claimTopicCreation(asTeamId("team-claim-intruder"), "a-team-claim-intruder", null, 1_000, TTL)).toBe(false);
      expect(await repo.claimTopicCreation(asTeamId("team-claim-owner"), "a-team-claim-owner", null, 1_000, TTL)).toBe(true);
    });

    it("releaseTopicClaim reopens the claim immediately", async () => {
      const repo = await seedAnalysis("team-claim-release", 927);
      const team = asTeamId("team-claim-release");
      expect(await repo.claimTopicCreation(team, "a-team-claim-release", null, 1_000, TTL)).toBe(true);
      expect(await repo.claimTopicCreation(team, "a-team-claim-release", null, 1_001, TTL)).toBe(false);

      await repo.releaseTopicClaim(team, "a-team-claim-release");

      expect(await repo.claimTopicCreation(team, "a-team-claim-release", null, 1_002, TTL)).toBe(true);
    });
  });

  describe("general message id and column preservation", () => {
    it("rows without an id read generalMessageId: null", async () => {
      await seedTeam("team-gm-null", 930);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: "a-gm-null", teamId: "team-gm-null", slug: "gm-null" }));

      const found = await repo.findById(asTeamId("team-gm-null"), "a-gm-null");

      expect(found?.generalMessageId).toBeNull();
    });

    it("setGeneralMessageId stores the id, and a later call overwrites it", async () => {
      await seedTeam("team-gm-set", 931);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      await repo.save(analysis({ id: "a-gm-set", teamId: "team-gm-set", slug: "gm-set" }));

      await repo.setGeneralMessageId(asTeamId("team-gm-set"), "a-gm-set", 4242);
      expect((await repo.findById(asTeamId("team-gm-set"), "a-gm-set"))?.generalMessageId).toBe(4242);

      await repo.setGeneralMessageId(asTeamId("team-gm-set"), "a-gm-set", 5151);
      expect((await repo.findBySlug(asTeamId("team-gm-set"), "gm-set"))?.generalMessageId).toBe(5151);
    });

    it("save never clobbers general_message_id or topic_claim_until", async () => {
      await seedTeam("team-gm-save", 932);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      const original = analysis({ id: "a-gm-save", teamId: "team-gm-save", slug: "gm-save" });
      await repo.save(original);
      await repo.setGeneralMessageId(asTeamId("team-gm-save"), "a-gm-save", 99);
      await repo.claimTopicCreation(asTeamId("team-gm-save"), "a-gm-save", null, 1_000, 60_000);

      await repo.save({ ...original, updatedAt: 777, generalMessageId: null });

      const row = await env.DB.prepare(
        "SELECT general_message_id, topic_claim_until FROM hackathon_analyses WHERE id = ?",
      )
        .bind("a-gm-save")
        .first<{ general_message_id: number | null; topic_claim_until: number }>();
      expect(row).toEqual({ general_message_id: 99, topic_claim_until: 61_000 });
    });

    it("persistAnalysis (job repo upsert) never clobbers general_message_id or topic_claim_until", async () => {
      await seedTeam("team-gm-persist", 933);
      const repo = createD1HackathonAnalysisRepo(env.DB);
      const original = analysis({ id: "a-gm-persist", teamId: "team-gm-persist", slug: "gm-persist" });
      await repo.save(original);
      await repo.setGeneralMessageId(asTeamId("team-gm-persist"), "a-gm-persist", 123);
      await repo.claimTopicCreation(asTeamId("team-gm-persist"), "a-gm-persist", null, 2_000, 60_000);
      await env.DB.prepare(
        `INSERT INTO hackathon_analysis_jobs
          (id, team_id, chat_id, utc_day, fetch_url, status, created_at, updated_at)
         VALUES ('job-gm', 'team-gm-persist', 1, '2026-01-01', 'https://x', 'running', 0, 0)`,
      ).run();

      const ok = await createD1AnalysisJobRepo(env.DB, { now: () => 0 }).persistAnalysis("job-gm", {
        ...original,
        updatedAt: 888,
      });

      const row = await env.DB.prepare(
        "SELECT general_message_id, topic_claim_until, updated_at FROM hackathon_analyses WHERE id = ?",
      )
        .bind("a-gm-persist")
        .first<{ general_message_id: number | null; topic_claim_until: number; updated_at: number }>();
      expect(ok).toBe(true);
      expect(row).toEqual({ general_message_id: 123, topic_claim_until: 62_000, updated_at: 888 });
    });
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
    const repo = createD1HackathonAnalysisRepo(failingDb);

    await expect(repo.findBySlug(asTeamId("any-team"), "any-slug")).rejects.toThrow(
      "D1_ERROR: simulated D1 outage",
    );
  });
});
