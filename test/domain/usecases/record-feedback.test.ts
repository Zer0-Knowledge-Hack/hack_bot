import { describe, expect, it, vi } from "vitest";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";
import type { RepoFullName } from "../../../src/domain/github";
import { recordFeedback } from "../../../src/domain/usecases/record-feedback";

describe("recordFeedback", () => {
  it("records a feedback note with explicit repo hint", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const feedbackRepo = {
      save,
      list: vi.fn(),
      updateStatus: vi.fn(),
    };
    const repoTopicLinkRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };
    const logger = { log: vi.fn() };
    const clock = { now: () => 12345 };
    const idGen = { newId: () => "note-uuid-1" };

    const note = await recordFeedback(
      {
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("mship-1"),
        threadId: null,
        rawText: "Issue with Freighter wallet",
        repoHint: "puls3",
        sourceType: "text",
      },
      {
        feedbackRepo,
        repoTopicLinkRepo,
        logger,
        clock,
        idGen,
      },
    );

    expect(note).toEqual({
      id: "note-uuid-1",
      teamId: asTeamId("team-1"),
      authorMembershipId: asMembershipId("mship-1"),
      repoHint: "puls3",
      rawText: "Issue with Freighter wallet",
      sourceType: "text",
      status: "inbox",
      createdAt: 12345,
      updatedAt: 12345,
    });
    expect(save).toHaveBeenCalledWith(asTeamId("team-1"), note);
  });

  it("infers repo hint from topic link if omitted", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const feedbackRepo = { save, list: vi.fn(), updateStatus: vi.fn() };
    const repoTopicLinkRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([
        {
          teamId: asTeamId("team-1"),
          repoFullName: "org/puls3" as RepoFullName,
          threadId: 99,
          createdAt: 0,
        },
      ]),
    };
    const logger = { log: vi.fn() };
    const clock = { now: () => 20000 };
    const idGen = { newId: () => "note-uuid-2" };

    const note = await recordFeedback(
      {
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("mship-1"),
        threadId: 99,
        rawText: "Login is broken in demo",
        sourceType: "voice",
      },
      {
        feedbackRepo,
        repoTopicLinkRepo,
        logger,
        clock,
        idGen,
      },
    );

    expect(note.repoHint).toBe("org/puls3");
    expect(note.sourceType).toBe("voice");
  });
});
