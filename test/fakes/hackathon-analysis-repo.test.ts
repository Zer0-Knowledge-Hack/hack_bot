import { describe, expect, it } from "vitest";
import { asTeamId } from "../../src/domain/ids";
import type { HackathonAnalysis } from "../../src/domain/entities";
import { fakeAnalysisJobRepo, fakeHackathonAnalysisRepo } from "./index";

const TEAM = asTeamId("team-1");

function analysis(overrides: Partial<HackathonAnalysis> = {}): HackathonAnalysis {
  return {
    id: "a-1",
    teamId: TEAM,
    slug: "meridian",
    sourceUrl: "https://example.com/e",
    normalizedUrl: "https://example.com/e",
    fields: {} as never,
    suggestedRepos: [],
    threadId: null,
    pinnedMessageId: null,
    generalMessageId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// The fake must mirror the D1 upsert: `save` never writes general_message_id
// or topic_claim_until, so a refresh cannot clobber them.
describe("fakeHackathonAnalysisRepo.save", () => {
  it("preserves the stored generalMessageId across a save", async () => {
    const repo = fakeHackathonAnalysisRepo();
    await repo.save(analysis());
    await repo.setGeneralMessageId(TEAM, "a-1", 555);

    await repo.save(analysis({ generalMessageId: null, updatedAt: 9 }));

    expect((await repo.findById(TEAM, "a-1"))?.generalMessageId).toBe(555);
    expect((await repo.findById(TEAM, "a-1"))?.updatedAt).toBe(9);
  });

  it("preserves the live claim state across a save", async () => {
    const repo = fakeHackathonAnalysisRepo();
    await repo.save(analysis());
    expect(await repo.claimTopicCreation(TEAM, "a-1", null, 100, 60_000)).toBe(true);

    await repo.save(analysis({ updatedAt: 5 }));

    expect(await repo.claimTopicCreation(TEAM, "a-1", null, 101, 60_000)).toBe(false);
  });

  it("does not keep the caller's object by reference", async () => {
    const repo = fakeHackathonAnalysisRepo();
    const input = analysis();
    await repo.save(input);

    input.slug = "mutated";

    expect((await repo.findById(TEAM, "a-1"))?.slug).toBe("meridian");
  });

  it("stores a first insert as given", async () => {
    const repo = fakeHackathonAnalysisRepo();
    await repo.save(analysis({ generalMessageId: 7 }));
    expect((await repo.findById(TEAM, "a-1"))?.generalMessageId).toBe(7);
  });
});

describe("fakeAnalysisJobRepo.persistAnalysis", () => {
  it("preserves the stored generalMessageId through the delegated save", async () => {
    const repo = fakeHackathonAnalysisRepo();
    await repo.save(analysis());
    await repo.setGeneralMessageId(TEAM, "a-1", 555);
    const jobs = fakeAnalysisJobRepo({ hackathonAnalysisRepo: repo });

    await jobs.persistAnalysis("job-1", analysis({ generalMessageId: null }));

    expect((await repo.findById(TEAM, "a-1"))?.generalMessageId).toBe(555);
  });
});
