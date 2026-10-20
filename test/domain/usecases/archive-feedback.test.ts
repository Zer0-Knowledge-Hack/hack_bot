import { describe, expect, it, vi } from "vitest";
import { asTeamId } from "../../../src/domain/ids";
import { archiveFeedback } from "../../../src/domain/usecases/archive-feedback";

describe("archiveFeedback", () => {
  it("updates status of given noteIds to triaged by default", async () => {
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    const feedbackRepo = {
      save: vi.fn(),
      list: vi.fn(),
      updateStatus,
    };
    const logger = { log: vi.fn() };

    const result = await archiveFeedback(
      {
        teamId: asTeamId("team-1"),
        noteIds: ["note-1", "note-2"],
      },
      { feedbackRepo, logger },
    );

    expect(result.updatedCount).toBe(2);
    expect(updateStatus).toHaveBeenCalledWith(
      asTeamId("team-1"),
      ["note-1", "note-2"],
      "triaged",
    );
  });

  it("handles empty noteIds list safely", async () => {
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    const feedbackRepo = { save: vi.fn(), list: vi.fn(), updateStatus };
    const logger = { log: vi.fn() };

    const result = await archiveFeedback(
      {
        teamId: asTeamId("team-1"),
        noteIds: [],
      },
      { feedbackRepo, logger },
    );

    expect(result.updatedCount).toBe(0);
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
