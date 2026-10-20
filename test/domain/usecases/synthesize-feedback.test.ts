import { describe, expect, it, vi } from "vitest";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";
import type { FeedbackNote } from "../../../src/domain/entities";
import { synthesizeFeedback } from "../../../src/domain/usecases/synthesize-feedback";

describe("synthesizeFeedback", () => {
  it("returns empty summary when no pending notes exist", async () => {
    const feedbackRepo = {
      save: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn(),
    };
    const repoTopicLinkRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };
    const synthesizer = { summarize: vi.fn() };
    const logger = { log: vi.fn() };

    const result = await synthesizeFeedback(
      { teamId: asTeamId("team-1"), repoHint: "puls3" },
      { feedbackRepo, repoTopicLinkRepo, synthesizer, logger },
    );

    expect(result.totalNotes).toBe(0);
    expect(result.startDate).toBeNull();
    expect(result.endDate).toBeNull();
    expect(result.summaryText).toBe("");
    expect(synthesizer.summarize).not.toHaveBeenCalled();
  });

  it("calculates real date range across irregular intervals and formats summary", async () => {
    const notes: FeedbackNote[] = [
      {
        id: "note-1",
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("m-1"),
        repoHint: "puls3",
        rawText: "First bug from 2 weeks ago",
        sourceType: "text",
        status: "inbox",
        createdAt: 100000,
        updatedAt: 100000,
      },
      {
        id: "note-2",
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("m-1"),
        repoHint: "puls3",
        rawText: "Second bug from today",
        sourceType: "voice",
        status: "inbox",
        createdAt: 500000,
        updatedAt: 500000,
      },
    ];

    const feedbackRepo = {
      save: vi.fn(),
      list: vi.fn().mockResolvedValue(notes),
      updateStatus: vi.fn(),
    };
    const repoTopicLinkRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };
    const synthesizer = {
      summarize: vi.fn().mockResolvedValue("- Recurring issue in Freighter wallet"),
    };
    const logger = { log: vi.fn() };

    const result = await synthesizeFeedback(
      { teamId: asTeamId("team-1"), repoHint: "puls3" },
      { feedbackRepo, repoTopicLinkRepo, synthesizer, logger },
    );

    expect(result.totalNotes).toBe(2);
    expect(result.startDate).toBe(100000);
    expect(result.endDate).toBe(500000);
    expect(result.summaryText).toBe("- Recurring issue in Freighter wallet");
    expect(result.noteIds).toEqual(["note-1", "note-2"]);
    expect(synthesizer.summarize).toHaveBeenCalledWith(notes, undefined);
  });
});
