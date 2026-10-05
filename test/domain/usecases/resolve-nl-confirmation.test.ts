import { describe, expect, it } from "vitest";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import { commonCopy, joinCopy, nlConfirmCopy } from "../../../src/adapters/telegram/copy";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { resolveNlConfirmation } from "../../../src/domain/usecases/resolve-nl-confirmation";
import {
  fakeAnalysisJobQueue,
  fakeAnalysisJobRepo,
  fakeAnalysisQuota,
  fakeChatAdminChecker,
  fakeChatPublisher,
  fakeClock,
  fakeForumTopicManager,
  fakeGithubOrgClaimRepo,
  fakeHackathonAnalysisRepo,
  fakeIdGen,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeNlConfirmationRepo,
  fakeProfileRepo,
  fakeRepoTopicLinkRepo,
  fakeSleep,
  fakeTeamRepo,
} from "../../fakes";

describe("resolveNlConfirmation — concurrent dual confirm (task 3.6a)", () => {
  it("invokes the mutate path at most once when ok-callback and sí race", async () => {
    const teamRepo = fakeTeamRepo();
    const memberRepo = fakeMemberRepo();
    const membershipRepo = fakeMembershipRepo(memberRepo);
    const nlConfirmationRepo = fakeNlConfirmationRepo();
    const chatPublisher = fakeChatPublisher();
    const clock = fakeClock();
    const teamId = asTeamId("team-race");
    const membershipId = asMembershipId("mem-race");
    const memberId = asMemberId("u-race");

    teamRepo.rows.push({ id: teamId, chatId: 10, dataTopicThreadId: null, createdAt: 0 });
    memberRepo.rows.push({ id: memberId, telegramUserId: 20, createdAt: 0 });
    membershipRepo.rows.push({
      id: membershipId,
      teamId,
      memberId,
      role: "member",
      joinedAt: 0,
    });
    nlConfirmationRepo.rows.push({
      id: "conf-race",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "join_team",
      slots: {},
      confirmMessageId: 88,
      expiresAt: clock.now() + 60_000,
      consumedAt: null,
      createdAt: clock.now(),
    });

    const deps = {
      teamRepo,
      memberRepo,
      membershipRepo,
      profileRepo: fakeProfileRepo(),
      hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
      repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
      githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
      analysisQuota: fakeAnalysisQuota(),
      analysisJobRepo: fakeAnalysisJobRepo(),
      analysisJobQueue: fakeAnalysisJobQueue(),
      chatAdminChecker: fakeChatAdminChecker([]),
      chatPublisher,
      forumTopicManager: fakeForumTopicManager(),
      nlConfirmationRepo,
      sleep: fakeSleep(),
      clock,
      idGen: fakeIdGen(),
      logger: createSafeLogger(),
      copy: {
        cancelled: nlConfirmCopy.cancelled,
        busy: nlConfirmCopy.busy,
        wrongActor: nlConfirmCopy.wrongActor,
        notMember: commonCopy.notMember,
        errorReplies: { AlreadyExistsError: joinCopy.alreadyMember },
      },
    };

    const [viaCallback, viaReply] = await Promise.all([
      resolveNlConfirmation(
        {
          chatId: 10,
          callerTelegramUserId: 20,
          confirmationId: "conf-race",
          action: "yes",
          callbackMessageId: 88,
        },
        deps,
      ),
      resolveNlConfirmation(
        {
          chatId: 10,
          callerTelegramUserId: 20,
          replyToConfirmMessageId: 88,
          action: "yes",
        },
        deps,
      ),
    ]);

    expect(nlConfirmationRepo.rows[0]?.consumedAt).not.toBeNull();
    const outcomes = [viaCallback, viaReply];
    const busy = outcomes.filter((o) => o.kind === "reply" && o.text === nlConfirmCopy.busy);
    const won = outcomes.filter((o) => o.kind === "reply" && o.text !== nlConfirmCopy.busy);
    expect(busy).toHaveLength(1);
    expect(won).toHaveLength(1);
  });

  it("replies busy and executes nothing when the confirmation is expired", async () => {
    const teamRepo = fakeTeamRepo();
    const memberRepo = fakeMemberRepo();
    const membershipRepo = fakeMembershipRepo(memberRepo);
    const nlConfirmationRepo = fakeNlConfirmationRepo();
    const chatPublisher = fakeChatPublisher();
    const clock = fakeClock();
    const teamId = asTeamId("team-exp");
    const membershipId = asMembershipId("mem-exp");
    const memberId = asMemberId("u-exp");

    teamRepo.rows.push({ id: teamId, chatId: 10, dataTopicThreadId: null, createdAt: 0 });
    memberRepo.rows.push({ id: memberId, telegramUserId: 20, createdAt: 0 });
    membershipRepo.rows.push({
      id: membershipId,
      teamId,
      memberId,
      role: "member",
      joinedAt: 0,
    });
    nlConfirmationRepo.rows.push({
      id: "conf-exp",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "join_team",
      slots: {},
      confirmMessageId: 44,
      expiresAt: clock.now() - 1,
      consumedAt: null,
      createdAt: clock.now() - 600_000,
    });
    const before = membershipRepo.rows.length;

    const result = await resolveNlConfirmation(
      {
        chatId: 10,
        callerTelegramUserId: 20,
        confirmationId: "conf-exp",
        action: "yes",
        callbackMessageId: 44,
      },
      {
        teamRepo,
        memberRepo,
        membershipRepo,
        profileRepo: fakeProfileRepo(),
        hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
        repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
        githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
        analysisQuota: fakeAnalysisQuota(),
        analysisJobRepo: fakeAnalysisJobRepo(),
        analysisJobQueue: fakeAnalysisJobQueue(),
        chatAdminChecker: fakeChatAdminChecker([]),
        chatPublisher,
        forumTopicManager: fakeForumTopicManager(),
        nlConfirmationRepo,
        sleep: fakeSleep(),
        clock,
        idGen: fakeIdGen(),
        logger: createSafeLogger(),
        copy: {
          cancelled: nlConfirmCopy.cancelled,
          busy: nlConfirmCopy.busy,
          wrongActor: nlConfirmCopy.wrongActor,
          notMember: commonCopy.notMember,
          errorReplies: { AlreadyExistsError: joinCopy.alreadyMember },
        },
      },
    );

    expect(result).toEqual({ kind: "reply", text: nlConfirmCopy.busy });
    expect(nlConfirmationRepo.rows[0]?.consumedAt).toBeNull();
    expect(membershipRepo.rows).toHaveLength(before);
  });
});
