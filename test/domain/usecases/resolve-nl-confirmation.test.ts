import { describe, expect, it } from "vitest";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import {
  commonCopy,
  joinCopy,
  nlConfirmCopy,
  participateCopy,
} from "../../../src/adapters/telegram/copy";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import {
  resolveNlConfirmation,
  resolveNlPick,
  type ResolveNlConfirmationCopy,
} from "../../../src/domain/usecases/resolve-nl-confirmation";
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

function baseSetup(opts: { editThrows?: boolean } = {}) {
  const teamRepo = fakeTeamRepo();
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  const nlConfirmationRepo = fakeNlConfirmationRepo();
  const chatPublisher = fakeChatPublisher({ editThrows: opts.editThrows });
  const clock = fakeClock();
  const teamId = asTeamId("team-nl-fix");
  const membershipId = asMembershipId("mem-nl-fix");
  const memberId = asMemberId("u-nl-fix");

  teamRepo.rows.push({ id: teamId, chatId: 10, dataTopicThreadId: null, createdAt: 0 });
  memberRepo.rows.push({ id: memberId, telegramUserId: 20, createdAt: 0 });
  membershipRepo.rows.push({
    id: membershipId,
    teamId,
    memberId,
    role: "member",
    joinedAt: 0,
  });

  const copy: ResolveNlConfirmationCopy = {
    cancelled: nlConfirmCopy.cancelled,
    busy: nlConfirmCopy.busy,
    wrongActor: nlConfirmCopy.wrongActor,
    notMember: commonCopy.notMember,
    executeFailed: nlConfirmCopy.executeFailed,
    errorReplies: {
      AlreadyExistsError: joinCopy.alreadyMember,
      TopicRightsMissingError: participateCopy.noRights,
    },
  };

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
    copy,
  };

  return { deps, teamId, membershipId, nlConfirmationRepo, chatPublisher, clock, copy };
}

describe("resolveNlConfirmation — concurrent dual confirm (task 3.6a)", () => {
  it("invokes the mutate path at most once when ok-callback and sí race", async () => {
    const { deps, teamId, membershipId, nlConfirmationRepo } = baseSetup();
    nlConfirmationRepo.rows.push({
      id: "conf-race",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "join_team",
      slots: {},
      confirmMessageId: 88,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

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
    const { deps, teamId, membershipId, nlConfirmationRepo } = baseSetup();
    nlConfirmationRepo.rows.push({
      id: "conf-exp",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "join_team",
      slots: {},
      confirmMessageId: 44,
      expiresAt: deps.clock.now() - 1,
      consumedAt: null,
      createdAt: deps.clock.now() - 600_000,
    });
    const before = deps.membershipRepo.rows.length;

    const result = await resolveNlConfirmation(
      {
        chatId: 10,
        callerTelegramUserId: 20,
        confirmationId: "conf-exp",
        action: "yes",
        callbackMessageId: 44,
      },
      deps,
    );

    expect(result).toEqual({ kind: "reply", text: nlConfirmCopy.busy });
    expect(nlConfirmationRepo.rows[0]?.consumedAt).toBeNull();
    expect(deps.membershipRepo.rows).toHaveLength(before);
  });

  it("refuses confirm from a different chatId without consuming", async () => {
    const { deps, teamId, membershipId, nlConfirmationRepo } = baseSetup();
    nlConfirmationRepo.rows.push({
      id: "conf-chat",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "join_team",
      slots: {},
      confirmMessageId: 45,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

    const result = await resolveNlConfirmation(
      {
        chatId: 999,
        callerTelegramUserId: 20,
        confirmationId: "conf-chat",
        action: "yes",
        callbackMessageId: 45,
      },
      deps,
    );

    expect(result).toEqual({ kind: "reply", text: nlConfirmCopy.busy });
    expect(nlConfirmationRepo.rows[0]?.consumedAt).toBeNull();
  });

  it("replies with mapped topic error after consume instead of throwing", async () => {
    const { deps, teamId, membershipId, nlConfirmationRepo } = baseSetup();
    const membership = deps.membershipRepo.rows.find((row) => row.id === membershipId);
    if (membership) membership.role = "admin";
    deps.hackathonAnalysisRepo.rows.push({
      id: "a-part",
      teamId,
      slug: "meridian",
      sourceUrl: "https://example.com/meridian",
      normalizedUrl: "https://example.com/meridian",
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
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    deps.forumTopicManager = fakeForumTopicManager({
      create: [{ fails: "no-rights" }],
    });
    nlConfirmationRepo.rows.push({
      id: "conf-topic",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "participate_hackathon",
      slots: { slug: "meridian" },
      confirmMessageId: 50,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

    const result = await resolveNlConfirmation(
      {
        chatId: 10,
        callerTelegramUserId: 20,
        confirmationId: "conf-topic",
        action: "yes",
        callbackMessageId: 50,
      },
      deps,
    );

    expect(result).toEqual({ kind: "reply", text: participateCopy.noRights });
    expect(nlConfirmationRepo.rows[0]?.consumedAt).not.toBeNull();
  });

  it("replies executeFailed for unmapped post-consume errors instead of throwing", async () => {
    const { deps, teamId, membershipId, nlConfirmationRepo } = baseSetup();
    // Force an unmapped failure: participate without an analysis row.
    const membership = deps.membershipRepo.rows.find((row) => row.id === membershipId);
    if (membership) membership.role = "admin";
    deps.copy = {
      ...deps.copy,
      errorReplies: {},
    };
    nlConfirmationRepo.rows.push({
      id: "conf-unmap",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "participate_hackathon",
      slots: { slug: "missing" },
      confirmMessageId: 51,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

    const result = await resolveNlConfirmation(
      {
        chatId: 10,
        callerTelegramUserId: 20,
        confirmationId: "conf-unmap",
        action: "yes",
        callbackMessageId: 51,
      },
      deps,
    );

    expect(result).toEqual({ kind: "reply", text: nlConfirmCopy.executeFailed });
    expect(nlConfirmationRepo.rows[0]?.consumedAt).not.toBeNull();
  });
});

describe("resolveNlPick", () => {
  it("on editMessage failure cancels the pick row and creates exactly one confirmable row", async () => {
    const { deps, teamId, membershipId, nlConfirmationRepo, chatPublisher } = baseSetup({
      editThrows: true,
    });
    nlConfirmationRepo.rows.push({
      id: "conf-pick",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "unlink_hackathon_topic",
      slots: { pickSlugs: ["bnb-a", "bnb-b"] },
      confirmMessageId: 70,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

    const result = await resolveNlPick(
      {
        chatId: 10,
        callerTelegramUserId: 20,
        confirmationId: "conf-pick",
        pickIndex: 0,
        callbackMessageId: 70,
      },
      {
        ...deps,
        confirmPrompt: nlConfirmCopy.confirmPrompt,
        confirmSummaries: nlConfirmCopy.summaries,
      },
    );

    expect(result).toEqual({ kind: "done" });
    const pickRow = nlConfirmationRepo.rows.find((row) => row.id === "conf-pick");
    expect(pickRow?.consumedAt).not.toBeNull();
    expect(pickRow?.slots.slug).toBeUndefined();
    const live = nlConfirmationRepo.rows.filter((row) => row.consumedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.slots.slug).toBe("bnb-a");
    expect(live[0]?.slots.pickSlugs).toBeUndefined();
    expect(chatPublisher.posted).toHaveLength(1);
    expect(chatPublisher.postOptions[0]?.nlConfirmId).toBe(live[0]?.id);
  });

  it("updates slots only after a successful edit", async () => {
    const { deps, teamId, membershipId, nlConfirmationRepo, chatPublisher } = baseSetup();
    nlConfirmationRepo.rows.push({
      id: "conf-pick-ok",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "unlink_hackathon_topic",
      slots: { pickSlugs: ["bnb-a", "bnb-b"] },
      confirmMessageId: 71,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

    const result = await resolveNlPick(
      {
        chatId: 10,
        callerTelegramUserId: 20,
        confirmationId: "conf-pick-ok",
        pickIndex: 1,
        callbackMessageId: 71,
      },
      {
        ...deps,
        confirmPrompt: nlConfirmCopy.confirmPrompt,
        confirmSummaries: nlConfirmCopy.summaries,
      },
    );

    expect(result).toEqual({ kind: "done" });
    expect(nlConfirmationRepo.rows).toHaveLength(1);
    expect(nlConfirmationRepo.rows[0]?.slots).toEqual({ slug: "bnb-b" });
    expect(nlConfirmationRepo.rows[0]?.consumedAt).toBeNull();
    expect(chatPublisher.edited).toHaveLength(1);
    expect(chatPublisher.edited[0]?.options?.nlConfirmId).toBe("conf-pick-ok");
  });
});
