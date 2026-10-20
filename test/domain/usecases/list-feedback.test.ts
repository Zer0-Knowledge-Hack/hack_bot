import { describe, expect, it, vi } from "vitest";
import { asTeamId } from "../../../src/domain/ids";
import type { RepoFullName } from "../../../src/domain/github";
import { listFeedback } from "../../../src/domain/usecases/list-feedback";

describe("listFeedback", () => {
  it("lists feedback with default inbox status", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const feedbackRepo = { save: vi.fn(), list, updateStatus: vi.fn() };
    const repoTopicLinkRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };

    await listFeedback(
      { teamId: asTeamId("team-1") },
      { feedbackRepo, repoTopicLinkRepo },
    );

    expect(list).toHaveBeenCalledWith(asTeamId("team-1"), {
      repoHint: undefined,
      status: "inbox",
      since: undefined,
      limit: undefined,
    });
  });

  it("resolves repo hint from threadId when in topic", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const feedbackRepo = { save: vi.fn(), list, updateStatus: vi.fn() };
    const repoTopicLinkRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([
        {
          teamId: asTeamId("team-1"),
          repoFullName: "org/puls3" as RepoFullName,
          threadId: 42,
          createdAt: 0,
        },
      ]),
    };

    await listFeedback(
      { teamId: asTeamId("team-1"), threadId: 42 },
      { feedbackRepo, repoTopicLinkRepo },
    );

    expect(list).toHaveBeenCalledWith(asTeamId("team-1"), {
      repoHint: "org/puls3",
      status: "inbox",
      since: undefined,
      limit: undefined,
    });
  });
});
