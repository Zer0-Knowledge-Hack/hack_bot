import { describe, expect, it } from "vitest";
import { requestHackathonAnalysis } from "../../../src/domain/usecases/request-hackathon-analysis";
import {
  AnalysisBusyError,
  DailyCapReachedError,
  QueueSendFailedError,
  UnauthorizedError,
} from "../../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import {
  fakeAnalysisJobQueue,
  fakeAnalysisJobRepo,
  fakeAnalysisQuota,
  fakeClock,
  fakeIdGen,
  fakeLogger,
  fakeMemberRepo,
  fakeMembershipRepo,
} from "../../fakes";

const teamId = asTeamId("team-1");
const CHAT_ID = 111;
const SOURCE_URL = "https://example.com/event";

function makeDeps(quotaResult?: "ok" | "busy" | "cap-reached", queueThrows = false) {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  return {
    membershipRepo,
    analysisQuota: fakeAnalysisQuota({ result: quotaResult }),
    analysisJobQueue: fakeAnalysisJobQueue({ throws: queueThrows }),
    analysisJobRepo: fakeAnalysisJobRepo(),
    clock: fakeClock(),
    idGen: fakeIdGen(),
    logger: fakeLogger(),
  };
}

function pushAdmin(deps: ReturnType<typeof makeDeps>) {
  const adminId = asMembershipId("m-admin");
  deps.membershipRepo.rows.push({
    id: adminId,
    teamId,
    memberId: asMemberId("u-admin"),
    role: "admin",
    joinedAt: 0,
  });
  return adminId;
}

function pushMember(deps: ReturnType<typeof makeDeps>) {
  const memberId = asMembershipId("m-member");
  deps.membershipRepo.rows.push({
    id: memberId,
    teamId,
    memberId: asMemberId("u-member"),
    role: "member",
    joinedAt: 0,
  });
  return memberId;
}

describe("requestHackathonAnalysis", () => {
  it("admin: reserves, enqueues, and acknowledges", async () => {
    const deps = makeDeps("ok");
    const actorMembershipId = pushAdmin(deps);

    const result = await requestHackathonAnalysis(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
      deps,
    );

    expect(result.replyText).toBe("Analizando example.com… el resultado se publicará aquí.");
    expect(deps.analysisQuota.reserved).toHaveLength(1);
    expect(deps.analysisJobQueue.sent).toHaveLength(1);
    expect(deps.analysisJobQueue.sent[0]!.jobId).toBe(result.jobId);
  });

  it("non-admin: refuses without reserving or enqueueing", async () => {
    const deps = makeDeps("ok");
    const actorMembershipId = pushMember(deps);

    await expect(
      requestHackathonAnalysis(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
        deps,
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.analysisQuota.reserved).toHaveLength(0);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("busy: refuses without consuming a cap slot (spec: Analysis already running)", async () => {
    const deps = makeDeps("busy");
    const actorMembershipId = pushAdmin(deps);

    await expect(
      requestHackathonAnalysis(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
        deps,
      ),
    ).rejects.toThrow(AnalysisBusyError);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("cap reached: refuses with a clear cap-exceeded error (spec: Cap reached)", async () => {
    const deps = makeDeps("cap-reached");
    const actorMembershipId = pushAdmin(deps);

    await expect(
      requestHackathonAnalysis(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
        deps,
      ),
    ).rejects.toThrow(DailyCapReachedError);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("enqueue failure: marks the job failed and refunds the reserved slot (spec: Enqueue failure)", async () => {
    const deps = makeDeps("ok", true);
    const actorMembershipId = pushAdmin(deps);

    await expect(
      requestHackathonAnalysis(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
        deps,
      ),
    ).rejects.toThrow(QueueSendFailedError);

    expect(deps.analysisJobRepo.failed).toHaveLength(1);
    expect(deps.analysisJobRepo.failed[0]!.reason).toBe("enqueue");
    expect(deps.analysisQuota.released).toHaveLength(1);
    expect(deps.analysisQuota.released[0]!.refund).toBe(true);
    expect(deps.logger.entries).toHaveLength(0);
  });

  it("enqueue failure: markFailed throwing still releases the slot and rethrows the original error (RESI-002)", async () => {
    const deps = makeDeps("ok", true);
    const actorMembershipId = pushAdmin(deps);
    deps.analysisJobRepo.markFailed = async () => {
      throw new Error("D1 unavailable");
    };

    await expect(
      requestHackathonAnalysis(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
        deps,
      ),
    ).rejects.toThrow(QueueSendFailedError);

    expect(deps.analysisQuota.released).toHaveLength(1);
    expect(deps.analysisQuota.released[0]!.refund).toBe(true);
    expect(deps.logger.entries).toContainEqual(
      expect.objectContaining({ event: "hackathon-enqueue-cleanup", outcome: "error", reason: "mark-failed-failed" }),
    );
  });

  it("enqueue failure: release throwing still rethrows the original error (RESI-002)", async () => {
    const deps = makeDeps("ok", true);
    const actorMembershipId = pushAdmin(deps);
    deps.analysisQuota.release = async () => {
      throw new Error("D1 unavailable");
    };

    await expect(
      requestHackathonAnalysis(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: null, sourceUrl: SOURCE_URL },
        deps,
      ),
    ).rejects.toThrow(QueueSendFailedError);

    expect(deps.analysisJobRepo.failed).toHaveLength(1);
    expect(deps.analysisJobRepo.failed[0]!.reason).toBe("enqueue");
    expect(deps.logger.entries).toContainEqual(
      expect.objectContaining({ event: "hackathon-enqueue-cleanup", outcome: "error", reason: "release-failed" }),
    );
  });
});
