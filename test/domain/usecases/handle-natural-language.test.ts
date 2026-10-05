import { describe, expect, it } from "vitest";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import { commonCopy, nlConfirmCopy, nlCopy, profileCopy } from "../../../src/adapters/telegram/copy";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { NL_CLASSIFY_DAILY_CAP } from "../../../src/domain/nl/intents";
import {
  handleNaturalLanguage,
  type HandleNaturalLanguageDeps,
  type NlCopyBag,
} from "../../../src/domain/usecases/handle-natural-language";
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
  fakeIntentClassifier,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeNlClassifyQuota,
  fakeNlConfirmationRepo,
  fakeProfileRepo,
  fakeRepoTopicLinkRepo,
  fakeSleep,
  fakeTeamRepo,
} from "../../fakes";

const COPY: NlCopyBag = {
  help: nlCopy.help,
  unknown: nlCopy.unknown,
  notConfigured: nlCopy.notConfigured,
  classifyFailed: nlCopy.classifyFailed,
  quota: nlCopy.quota,
  notMember: commonCopy.notMember,
  clarifySlug: nlCopy.clarifySlug,
  clarifyTopic: nlCopy.clarifyTopic,
  noTopicAnalysis: nlCopy.noTopicAnalysis,
  noAnalysis: nlCopy.noAnalysis,
  hackathonNotLinked: nlCopy.hackathonNotLinked,
  unlinkWrongTopic: nlCopy.unlinkWrongTopic,
  unlinkWrongTopicMany: nlCopy.unlinkWrongTopicMany,
  pickUnlink: nlCopy.pickUnlink,
  noLinkedMatch: nlCopy.noLinkedMatch,
  dataChannelOnly: profileCopy.dataChannelOnly,
  profileDataChannelOnly: nlConfirmCopy.profileDataChannelOnly,
  clarifyMembership: nlConfirmCopy.clarifyMembership,
  clarifyRepo: nlConfirmCopy.clarifyRepo,
  clarifyUrl: nlConfirmCopy.clarifyUrl,
  clarifyThread: nlConfirmCopy.clarifyThread,
  lexiconHint: nlConfirmCopy.lexiconHint,
  confirmPrompt: nlConfirmCopy.confirmPrompt,
  confirmSummaries: nlConfirmCopy.summaries,
  resolveCopy: {
    cancelled: nlConfirmCopy.cancelled,
    busy: nlConfirmCopy.busy,
    wrongActor: nlConfirmCopy.wrongActor,
    notMember: commonCopy.notMember,
    errorReplies: {
      AlreadyExistsError: "Ya eres miembro de este equipo.",
    },
  },
};

function seedMemberTeam(
  repos: {
    teamRepo: ReturnType<typeof fakeTeamRepo>;
    memberRepo: ReturnType<typeof fakeMemberRepo>;
    membershipRepo: ReturnType<typeof fakeMembershipRepo>;
  },
  opts: { chatId: number; userId: number; dataTopicThreadId?: number | null } = {
    chatId: 10,
    userId: 20,
  },
) {
  const teamId = asTeamId("team-nl");
  const memberId = asMemberId("member-nl");
  const membershipId = asMembershipId("mem-nl");
  repos.teamRepo.rows.push({
    id: teamId,
    chatId: opts.chatId,
    dataTopicThreadId: opts.dataTopicThreadId ?? null,
    createdAt: 0,
  });
  repos.memberRepo.rows.push({
    id: memberId,
    telegramUserId: opts.userId,
    createdAt: 0,
  });
  repos.membershipRepo.rows.push({
    id: membershipId,
    teamId,
    memberId,
    role: "member",
    joinedAt: 0,
  });
  return { teamId, membershipId };
}

function makeDeps(
  overrides: Partial<{
    nlModelPrimary: string;
    quotaAllow: boolean;
    intent: Parameters<typeof fakeIntentClassifier>[0];
  }> = {},
) {
  const teamRepo = fakeTeamRepo();
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  const nlClassifyQuota = fakeNlClassifyQuota({ allow: overrides.quotaAllow ?? true });
  const nlConfirmationRepo = fakeNlConfirmationRepo();
  const intentClassifier = fakeIntentClassifier(overrides.intent);
  const chatPublisher = fakeChatPublisher();
  const hackathonAnalysisRepo = fakeHackathonAnalysisRepo();
  const deps: HandleNaturalLanguageDeps = {
    teamRepo,
    memberRepo,
    membershipRepo,
    profileRepo: fakeProfileRepo(),
    hackathonAnalysisRepo,
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
    analysisQuota: fakeAnalysisQuota(),
    analysisJobRepo: fakeAnalysisJobRepo(),
    analysisJobQueue: fakeAnalysisJobQueue(),
    chatAdminChecker: fakeChatAdminChecker([]),
    chatPublisher,
    forumTopicManager: fakeForumTopicManager(),
    nlClassifyQuota,
    nlConfirmationRepo,
    intentClassifier,
    sleep: fakeSleep(),
    clock: fakeClock(),
    idGen: fakeIdGen(),
    logger: createSafeLogger(),
    nlModelPrimary: overrides.nlModelPrimary ?? "@cf/test/model",
    copy: COPY,
    formatRepoLinks: (links) =>
      links.length === 0 ? "none" : links.map((l) => l.repoFullName).join(","),
    formatProfiles: (_m, _f, teamId) => `profiles:${teamId}`,
  };
  return {
    deps,
    repos: { teamRepo, memberRepo, membershipRepo, hackathonAnalysisRepo },
    nlClassifyQuota,
    nlConfirmationRepo,
    intentClassifier,
    chatPublisher,
  };
}

describe("handleNaturalLanguage", () => {
  it("ignores when no team is registered for the chat", async () => {
    const { deps } = makeDeps();
    expect(
      await handleNaturalLanguage(
        {
          chatId: 99,
          threadId: null,
          callerTelegramUserId: 1,
          classifiedText: "ayuda",
        },
        deps,
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("short-circuits on missing model without classifying", async () => {
    const { deps, repos, intentClassifier, nlClassifyQuota } = makeDeps({
      nlModelPrimary: "  ",
    });
    seedMemberTeam(repos);
    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "ayuda",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.notConfigured });
    expect(intentClassifier.calls).toHaveLength(0);
    expect(nlClassifyQuota.reserved).toHaveLength(0);
  });

  it("short-circuits on quota exhaustion without classifying", async () => {
    const { deps, repos, intentClassifier } = makeDeps({ quotaAllow: false });
    seedMemberTeam(repos);
    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "hackathons",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.quota });
    expect(intentClassifier.calls).toHaveLength(0);
  });

  it("reserves with the domain daily cap", async () => {
    const { deps, repos, nlClassifyQuota } = makeDeps();
    seedMemberTeam(repos);
    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "ayuda",
      },
      deps,
    );
    expect(nlClassifyQuota.reserved[0]?.cap).toBe(NL_CLASSIFY_DAILY_CAP);
  });

  it("replies help and unknown from classifier", async () => {
    const help = makeDeps({
      intent: async () => ({ intent: "help", confidence: 0.95, slots: {} }),
    });
    seedMemberTeam(help.repos);
    expect(
      await handleNaturalLanguage(
        { chatId: 10, threadId: null, callerTelegramUserId: 20, classifiedText: "ayuda" },
        help.deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.help });

    const unknown = makeDeps({
      intent: async () => ({ intent: "unknown", confidence: 0.2, slots: {} }),
    });
    seedMemberTeam(unknown.repos);
    expect(
      await handleNaturalLanguage(
        { chatId: 10, threadId: null, callerTelegramUserId: 20, classifiedText: "???" },
        unknown.deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.unknown });
  });

  it("creates a confirmation for join_team without executing join", async () => {
    const { deps, repos, nlConfirmationRepo, chatPublisher } = makeDeps({
      intent: async () => ({ intent: "join_team", confidence: 0.9, slots: {} }),
    });
    seedMemberTeam(repos);
    const before = repos.membershipRepo.rows.length;
    const result = await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "quiero unirme",
      },
      deps,
    );
    expect(result).toEqual({ kind: "done" });
    expect(nlConfirmationRepo.rows).toHaveLength(1);
    expect(nlConfirmationRepo.rows[0]?.intent).toBe("join_team");
    expect(chatPublisher.posted[0]?.text).toContain("unirte");
    expect(chatPublisher.posted[0]?.text).toContain("sí");
    expect(chatPublisher.postOptions[0]?.nlConfirmId).toBe(nlConfirmationRepo.rows[0]?.id);
    expect(repos.membershipRepo.rows).toHaveLength(before);
  });

  it("refuses set_profile_field outside the data channel without a confirmation", async () => {
    const { deps, repos, nlConfirmationRepo } = makeDeps({
      intent: async () => ({
        intent: "set_profile_field",
        confidence: 0.9,
        slots: { profileField: "full_name", profileValue: "secret-name" },
      }),
    });
    seedMemberTeam(repos, { chatId: 10, userId: 20, dataTopicThreadId: 55 });
    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "poné mi nombre",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.profileDataChannelOnly });
    expect(nlConfirmationRepo.rows).toHaveLength(0);
  });

  it("confirm text for set_profile_field omits the profile value", async () => {
    const secret = "secret-pii-value";
    const { deps, repos, chatPublisher, nlConfirmationRepo } = makeDeps({
      intent: async () => ({
        intent: "set_profile_field",
        confidence: 0.9,
        slots: { profileField: "full_name", profileValue: secret },
      }),
    });
    seedMemberTeam(repos, { chatId: 10, userId: 20, dataTopicThreadId: 55 });
    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: 55,
        callerTelegramUserId: 20,
        classifiedText: "mi nombre es X",
      },
      deps,
    );
    expect(chatPublisher.posted[0]?.text).not.toContain(secret);
    expect(chatPublisher.posted[0]?.text).toContain("full_name");
    expect(nlConfirmationRepo.rows[0]?.slots.profileValue).toBe(secret);
  });

  it("resolves sí reply to a pending confirm without classifying", async () => {
    const { deps, repos, nlConfirmationRepo, intentClassifier } = makeDeps();
    const { membershipId, teamId } = seedMemberTeam(repos);
    nlConfirmationRepo.rows.push({
      id: "conf-reply",
      teamId,
      chatId: 10,
      threadId: null,
      actorMembershipId: membershipId,
      intent: "join_team",
      slots: {},
      confirmMessageId: 77,
      expiresAt: deps.clock.now() + 60_000,
      consumedAt: null,
      createdAt: deps.clock.now(),
    });

    const result = await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "sí",
        replyToMessageId: 77,
      },
      deps,
    );
    expect(intentClassifier.calls).toHaveLength(0);
    expect(result.kind).toBe("reply");
    expect(nlConfirmationRepo.rows[0]?.consumedAt).not.toBeNull();
  });

  it("refuses show_profiles outside the data channel", async () => {
    const { deps, repos } = makeDeps({
      intent: async () => ({ intent: "show_profiles", confidence: 0.9, slots: {} }),
    });
    seedMemberTeam(repos, { chatId: 10, userId: 20, dataTopicThreadId: 55 });
    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "perfiles",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.dataChannelOnly });
  });

  it("promote_member with explicit membershipId creates a confirmation", async () => {
    const targetId = "mem-target";
    const { deps, repos, nlConfirmationRepo, chatPublisher } = makeDeps({
      intent: async () => ({
        intent: "promote_member",
        confidence: 0.9,
        slots: { membershipId: targetId },
      }),
    });
    seedMemberTeam(repos);
    repos.memberRepo.rows.push({
      id: asMemberId("member-target"),
      telegramUserId: 30,
      createdAt: 0,
    });
    repos.membershipRepo.rows.push({
      id: asMembershipId(targetId),
      teamId: asTeamId("team-nl"),
      memberId: asMemberId("member-target"),
      role: "member",
      joinedAt: 0,
    });

    const result = await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "promové a ese",
      },
      deps,
    );
    expect(result).toEqual({ kind: "done" });
    expect(nlConfirmationRepo.rows[0]?.slots.membershipId).toBe(targetId);
    expect(chatPublisher.posted[0]?.text).toContain(targetId);
    expect(chatPublisher.posted[0]?.text).toContain("administrador");
  });

  it("promote_member resolves reply-to-user membership without guessing names", async () => {
    const { deps, repos, nlConfirmationRepo } = makeDeps({
      intent: async () => ({
        intent: "promote_member",
        confidence: 0.9,
        slots: {},
      }),
    });
    seedMemberTeam(repos);
    repos.memberRepo.rows.push({
      id: asMemberId("member-target"),
      telegramUserId: 30,
      createdAt: 0,
    });
    repos.membershipRepo.rows.push({
      id: asMembershipId("mem-target"),
      teamId: asTeamId("team-nl"),
      memberId: asMemberId("member-target"),
      role: "member",
      joinedAt: 0,
    });

    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "promovelo",
        replyFromUserId: 30,
      },
      deps,
    );
    expect(nlConfirmationRepo.rows[0]?.slots.membershipId).toBe("mem-target");
  });

  it("promote_member clarifies when target is missing or not a team member", async () => {
    const { deps, repos, nlConfirmationRepo } = makeDeps({
      intent: async () => ({
        intent: "promote_member",
        confidence: 0.9,
        slots: {},
      }),
    });
    seedMemberTeam(repos);

    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "promové a alguien",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.clarifyMembership });
    expect(nlConfirmationRepo.rows).toHaveLength(0);

    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "promovelo",
          replyFromUserId: 999,
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.clarifyMembership });
    expect(nlConfirmationRepo.rows).toHaveLength(0);
  });

  it("demote_member resolves reply-to-user the same way", async () => {
    const { deps, repos, nlConfirmationRepo, chatPublisher } = makeDeps({
      intent: async () => ({
        intent: "demote_member",
        confidence: 0.9,
        slots: {},
      }),
    });
    seedMemberTeam(repos);
    repos.memberRepo.rows.push({
      id: asMemberId("member-admin2"),
      telegramUserId: 31,
      createdAt: 0,
    });
    repos.membershipRepo.rows.push({
      id: asMembershipId("mem-admin2"),
      teamId: asTeamId("team-nl"),
      memberId: asMemberId("member-admin2"),
      role: "admin",
      joinedAt: 0,
    });

    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "degrada a este",
        replyFromUserId: 31,
      },
      deps,
    );
    expect(nlConfirmationRepo.rows[0]?.intent).toBe("demote_member");
    expect(nlConfirmationRepo.rows[0]?.slots.membershipId).toBe("mem-admin2");
    expect(chatPublisher.posted[0]?.text).toContain("miembro");
  });

  it("unlink_hackathon_topic resolves slug from the current topic link", async () => {
    const { deps, repos, nlConfirmationRepo, chatPublisher } = makeDeps({
      intent: async () => ({
        intent: "unlink_hackathon_topic",
        confidence: 0.92,
        slots: {},
      }),
    });
    seedMemberTeam(repos);
    repos.hackathonAnalysisRepo.rows.push({
      id: "a-meta",
      teamId: asTeamId("team-nl"),
      slug: "meta-vr",
      sourceUrl: "https://example.com/meta",
      normalizedUrl: "https://example.com/meta",
      fields: {
        name: { value: "Meta", snippet: "", confidence: 0.9 },
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
      threadId: 77,
      pinnedMessageId: 9,
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });

    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: 77,
        callerTelegramUserId: 20,
        classifiedText: "desvincula esta hackathon",
      },
      deps,
    );

    expect(nlConfirmationRepo.rows).toHaveLength(1);
    expect(nlConfirmationRepo.rows[0]?.intent).toBe("unlink_hackathon_topic");
    expect(nlConfirmationRepo.rows[0]?.slots.slug).toBe("meta-vr");
    expect(chatPublisher.posted[0]?.text).toContain("meta-vr");
  });

  it("unlink_hackathon_topic clarifies when the topic has no linked analysis", async () => {
    const { deps, repos, nlConfirmationRepo } = makeDeps({
      intent: async () => ({
        intent: "unlink_hackathon_topic",
        confidence: 0.9,
        slots: {},
      }),
    });
    seedMemberTeam(repos);

    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: 77,
          callerTelegramUserId: 20,
          classifiedText: "desvincula esta",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.noTopicAnalysis });
    expect(nlConfirmationRepo.rows).toHaveLength(0);
  });

  it("unlink_hackathon_topic hints the linked slug when this topic has none", async () => {
    const { deps, repos, nlConfirmationRepo, chatPublisher } = makeDeps({
      intent: async () => ({
        intent: "unlink_hackathon_topic",
        confidence: 0.9,
        slots: {},
      }),
    });
    seedMemberTeam(repos);
    repos.hackathonAnalysisRepo.rows.push({
      id: "a-bnb",
      teamId: asTeamId("team-nl"),
      slug: "bnb-linked",
      sourceUrl: "https://example.com/bnb",
      normalizedUrl: "https://example.com/bnb",
      fields: {
        name: { value: "BNB", snippet: "", confidence: 0.9 },
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
      threadId: 99,
      pinnedMessageId: 1,
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });

    // Bare "esta" with exactly one team-linked analysis → confirm that one.
    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: 77,
        callerTelegramUserId: 20,
        classifiedText: "desvincula esta hackathon",
      },
      deps,
    );
    expect(nlConfirmationRepo.rows).toHaveLength(1);
    expect(nlConfirmationRepo.rows[0]?.slots.slug).toBe("bnb-linked");
    expect(chatPublisher.posted[0]?.text).toContain("bnb-linked");
  });

  it("unlink_hackathon_topic accepts an explicit linked slug from another topic", async () => {
    const { deps, repos, nlConfirmationRepo } = makeDeps({
      intent: async () => ({
        intent: "unlink_hackathon_topic",
        confidence: 0.9,
        slots: { slug: "bnb-linked" },
      }),
    });
    seedMemberTeam(repos);
    repos.hackathonAnalysisRepo.rows.push({
      id: "a-bnb",
      teamId: asTeamId("team-nl"),
      slug: "bnb-linked",
      sourceUrl: "https://example.com/bnb",
      normalizedUrl: "https://example.com/bnb",
      fields: {
        name: { value: "BNB", snippet: "", confidence: 0.9 },
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
      threadId: 99,
      pinnedMessageId: 1,
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });

    await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: 77,
        callerTelegramUserId: 20,
        classifiedText: "desvincula bnb-linked",
      },
      deps,
    );
    expect(nlConfirmationRepo.rows[0]?.slots.slug).toBe("bnb-linked");
  });

  it("unlink_hackathon_topic offers pick buttons when several names match", async () => {
    const { deps, repos, nlConfirmationRepo, chatPublisher } = makeDeps({
      intent: async () => ({
        intent: "unlink_hackathon_topic",
        confidence: 0.9,
        slots: { targetName: "BNB" },
      }),
    });
    seedMemberTeam(repos);
    for (const [id, slug, name, threadId] of [
      ["a1", "bnb-online", "BNB Hack Online", 11],
      ["a2", "bnb-tokenized", "BNB Hack Tokenized", 12],
    ] as const) {
      repos.hackathonAnalysisRepo.rows.push({
        id,
        teamId: asTeamId("team-nl"),
        slug,
        sourceUrl: `https://example.com/${slug}`,
        normalizedUrl: `https://example.com/${slug}`,
        fields: {
          name: { value: name, snippet: "", confidence: 0.9 },
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
        threadId,
        pinnedMessageId: 1,
        generalMessageId: null,
        createdAt: 0,
        updatedAt: 0,
      });
    }

    const result = await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "desvincula la hackathon de BNB",
      },
      deps,
    );
    expect(result).toEqual({ kind: "done" });
    expect(nlConfirmationRepo.rows[0]?.slots.pickSlugs).toEqual(["bnb-online", "bnb-tokenized"]);
    expect(chatPublisher.postOptions[0]?.nlPick?.labels).toEqual([
      "BNB Hack Online",
      "BNB Hack Tokenized",
    ]);
  });
});
