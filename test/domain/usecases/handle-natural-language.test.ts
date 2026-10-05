import { describe, expect, it } from "vitest";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import { commonCopy, nlCopy, profileCopy } from "../../../src/adapters/telegram/copy";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { NL_CLASSIFY_DAILY_CAP } from "../../../src/domain/nl/intents";
import {
  handleNaturalLanguage,
  type HandleNaturalLanguageDeps,
  type NlCopyBag,
} from "../../../src/domain/usecases/handle-natural-language";
import {
  fakeClock,
  fakeGithubOrgClaimRepo,
  fakeHackathonAnalysisRepo,
  fakeIntentClassifier,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeNlClassifyQuota,
  fakeProfileRepo,
  fakeRepoTopicLinkRepo,
  fakeTeamRepo,
} from "../../fakes";

const COPY: NlCopyBag = {
  help: nlCopy.help,
  unknown: nlCopy.unknown,
  notConfigured: nlCopy.notConfigured,
  classifyFailed: nlCopy.classifyFailed,
  quota: nlCopy.quota,
  notMember: commonCopy.notMember,
  mutateDeferred: nlCopy.mutateDeferred,
  clarifySlug: nlCopy.clarifySlug,
  clarifyTopic: nlCopy.clarifyTopic,
  noTopicAnalysis: nlCopy.noTopicAnalysis,
  noAnalysis: nlCopy.noAnalysis,
  dataChannelOnly: profileCopy.dataChannelOnly,
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
  const intentClassifier = fakeIntentClassifier(overrides.intent);
  const deps: HandleNaturalLanguageDeps = {
    teamRepo,
    memberRepo,
    membershipRepo,
    profileRepo: fakeProfileRepo(),
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
    nlClassifyQuota,
    intentClassifier,
    clock: fakeClock(),
    logger: createSafeLogger(),
    nlModelPrimary: overrides.nlModelPrimary ?? "@cf/test/model",
    copy: COPY,
    formatRepoLinks: (links) =>
      links.length === 0 ? "none" : links.map((l) => l.repoFullName).join(","),
    formatProfiles: (_m, _f, teamId) => `profiles:${teamId}`,
  };
  return {
    deps,
    repos: { teamRepo, memberRepo, membershipRepo },
    nlClassifyQuota,
    intentClassifier,
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

  it("dispatches list_hackathons via listAnalyses", async () => {
    const { deps, repos } = makeDeps({
      intent: async () => ({ intent: "list_hackathons", confidence: 0.9, slots: {} }),
    });
    seedMemberTeam(repos);
    const result = await handleNaturalLanguage(
      {
        chatId: 10,
        threadId: null,
        callerTelegramUserId: 20,
        classifiedText: "listá hackathons",
      },
      deps,
    );
    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      expect(result.text.length).toBeGreaterThan(0);
    }
  });

  it("asks for slug when show_hackathon has no slot", async () => {
    const { deps, repos } = makeDeps({
      intent: async () => ({ intent: "show_hackathon", confidence: 0.9, slots: {} }),
    });
    seedMemberTeam(repos);
    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "mostrá el hack",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.clarifySlug });
  });

  it("defers mutate intents until confirm PR", async () => {
    const { deps, repos } = makeDeps({
      intent: async () => ({ intent: "join_team", confidence: 0.9, slots: {} }),
    });
    seedMemberTeam(repos);
    expect(
      await handleNaturalLanguage(
        {
          chatId: 10,
          threadId: null,
          callerTelegramUserId: 20,
          classifiedText: "quiero unirme",
        },
        deps,
      ),
    ).toEqual({ kind: "reply", text: COPY.mutateDeferred });
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
});
