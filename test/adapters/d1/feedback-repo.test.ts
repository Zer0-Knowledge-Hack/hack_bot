import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1FeedbackRepo } from "../../../src/adapters/d1/feedback-repo";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";

async function seedTeamAndMember(teamId: string, memberId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    ).bind(teamId, Math.floor(Math.random() * 1000000), 0),
    env.DB.prepare(
      "INSERT OR IGNORE INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
    ).bind(memberId, Math.floor(Math.random() * 1000000), 0),
    env.DB.prepare(
      "INSERT OR IGNORE INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)",
    ).bind(`mship-${memberId}`, teamId, memberId, 0),
  ]);
  return asMembershipId(`mship-${memberId}`);
}

describe("createD1FeedbackRepo", () => {
  it("saves and lists feedback notes scoped to team", async () => {
    const teamId = asTeamId("team-fb-1");
    const authorId = await seedTeamAndMember("team-fb-1", "user-fb-1");
    const repo = createD1FeedbackRepo(env.DB);

    const note1 = {
      id: "note-1",
      teamId,
      authorMembershipId: authorId,
      repoHint: "puls3",
      rawText: "Demo bug in Freighter wallet connection",
      sourceType: "text" as const,
      status: "inbox" as const,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const note2 = {
      id: "note-2",
      teamId,
      authorMembershipId: authorId,
      repoHint: "hack_bot",
      rawText: "Voice note transcription worked well",
      sourceType: "voice" as const,
      status: "inbox" as const,
      createdAt: 2000,
      updatedAt: 2000,
    };

    await repo.save(teamId, note1);
    await repo.save(teamId, note2);

    const allNotes = await repo.list(teamId);
    expect(allNotes).toEqual([note1, note2]);

    const puls3Notes = await repo.list(teamId, { repoHint: "puls3" });
    expect(puls3Notes).toEqual([note1]);
  });

  it("updates feedback note status across multiple IDs", async () => {
    const teamId = asTeamId("team-fb-2");
    const authorId = await seedTeamAndMember("team-fb-2", "user-fb-2");
    const repo = createD1FeedbackRepo(env.DB);

    await repo.save(teamId, {
      id: "note-update-1",
      teamId,
      authorMembershipId: authorId,
      repoHint: null,
      rawText: "Feedback item 1",
      sourceType: "text",
      status: "inbox",
      createdAt: 100,
      updatedAt: 100,
    });

    await repo.save(teamId, {
      id: "note-update-2",
      teamId,
      authorMembershipId: authorId,
      repoHint: null,
      rawText: "Feedback item 2",
      sourceType: "text",
      status: "inbox",
      createdAt: 200,
      updatedAt: 200,
    });

    await repo.updateStatus(teamId, ["note-update-1", "note-update-2"], "triaged");

    const triaged = await repo.list(teamId, { status: "triaged" });
    expect(triaged).toHaveLength(2);
    expect(triaged.map((n) => n.id)).toEqual(["note-update-1", "note-update-2"]);

    const pending = await repo.list(teamId, { status: "inbox" });
    expect(pending).toHaveLength(0);
  });
});
