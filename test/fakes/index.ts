import {
  AlertSendFailedError,
  ForumTopicCreateError,
  PublishFailedError,
  QueueSendFailedError,
  TenantMismatchError,
} from "../../src/domain/errors";
import type { AlertSendFailureClass } from "../../src/domain/errors";
import type {
  AnalysisJobMessage,
  AuditDraft,
  ClaimResult,
  HackathonAnalysis,
  Member,
  Membership,
  NewAnalysisJob,
  ProfileField,
  RepoTopicLink,
  Role,
  DmSelection,
  Team,
} from "../../src/domain/entities";
import type { RepoFullName } from "../../src/domain/github";
import type {
  AlertSender,
  AnalysisJobQueue,
  AnalysisJobRepo,
  AnalysisQuota,
  ChatAdminChecker,
  ChatPublisher,
  Clock,
  ForumTopicManager,
  Sleep,
  TopicCreateOptions,
  DmSelectionRepo,
  GithubOrgClaimRepo,
  HackathonAnalysisRepo,
  IdGen,
  LogEvent,
  Logger,
  LlmExtractor,
  LlmOutputMeta,
  IntentClassifier,
  MemberRepo,
  MembershipRepo,
  NlClassifyQuota,
  NlConfirmationRepo,
  PageFetcher,
  PostOptions,
  ProfileRepo,
  RepoMetadataSource,
  RepoTopicLinkRepo,
  TeamRepo,
  TopicCreateFailure,
} from "../../src/domain/ports";
import type { MemberId, MembershipId, TeamId } from "../../src/domain/ids";
import type {
  IntentClassifierInput,
  IntentResult,
} from "../../src/domain/nl/intents";
import type { NlConfirmation } from "../../src/domain/nl/confirmation";
import { stubNlIntent } from "../../src/domain/nl/eligibility";

// In-memory fakes for domain tests. Pure Vitest, no Workers runtime needed —
// this proves the domain layer has zero infrastructure dependencies.

// REL-001: fakes record actor/target membership alongside each audit draft
// so use-case tests can assert the acting membership (and, where
// applicable, the target membership) are passed correctly — mirroring the
// real D1 adapters' NOT NULL actor_membership_id/target_membership_id FKs.
export type RecordedAudit = AuditDraft & {
  actorMembershipId: MembershipId;
  targetMembershipId: MembershipId;
};

export function fakeClock(startMs = 1_700_000_000_000): Clock & { advance(ms: number): void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export function fakeIdGen(): IdGen {
  let counter = 0;
  return { newId: () => `id-${++counter}` };
}

export function fakeTeamRepo(): TeamRepo & {
  rows: Team[];
  audits: RecordedAudit[];
} {
  const rows: Team[] = [];
  const audits: RecordedAudit[] = [];
  return {
    rows,
    audits,
    findByChatId: async (chatId) =>
      rows.find((t) => t.chatId === chatId) ?? null,
    get: async (teamId) => rows.find((t) => t.id === teamId) ?? null,
    create: async (team) => {
      rows.push(team);
    },
    bindDataChannel: async (teamId, threadId, actorMembershipId, audit) => {
      const team = rows.find((t) => t.id === teamId);
      if (team) team.dataTopicThreadId = threadId;
      // Team-level action, no separate "target member" — actor and target
      // are the same acting membership (mirrors the D1 adapter).
      audits.push({ ...audit, actorMembershipId, targetMembershipId: actorMembershipId });
    },
  };
}

export function fakeMemberRepo(): MemberRepo & { rows: Member[] } {
  const rows: Member[] = [];
  return {
    rows,
    findByTelegramUserId: async (telegramUserId) =>
      rows.find((m) => m.telegramUserId === telegramUserId) ?? null,
    // Mimics the D1 adapter's ON CONFLICT (telegram_user_id) DO NOTHING +
    // re-SELECT contract (RES-002): a second upsert for the same
    // telegramUserId with a different id MUST NOT reassign the row — it
    // returns the FIRST persisted member, never the caller's.
    upsert: async (member) => {
      const existing = rows.find((m) => m.telegramUserId === member.telegramUserId);
      if (existing) return existing;
      rows.push(member);
      return member;
    },
  };
}

// `memberRepo` is used to resolve telegramUserId -> memberId for
// `findByUser`, mirroring how the real D1 repo would join through members.
export function fakeMembershipRepo(
  memberRepo: MemberRepo & { rows: Member[] },
): MembershipRepo & { rows: Membership[]; audits: RecordedAudit[] } {
  const rows: Membership[] = [];
  const audits: RecordedAudit[] = [];
  return {
    rows,
    audits,
    findByUser: async (telegramUserId: number) => {
      const member = memberRepo.rows.find(
        (m) => m.telegramUserId === telegramUserId,
      );
      if (!member) return [];
      return rows.filter((m) => m.memberId === member.id);
    },
    get: async (teamId: TeamId, membershipId: MembershipId) =>
      rows.find((m) => m.teamId === teamId && m.id === membershipId) ?? null,
    getByMember: async (teamId: TeamId, memberId: MemberId) =>
      rows.find((m) => m.teamId === teamId && m.memberId === memberId) ??
      null,
    listByTeam: async (teamId: TeamId) =>
      rows.filter((m) => m.teamId === teamId),
    create: async (membership, audit) => {
      rows.push(membership);
      // Self-created membership (setup/join): actor and target are the
      // same person bootstrapping their own membership (mirrors the D1
      // adapter's `membership.id` used as both actor and target).
      audits.push({ ...audit, actorMembershipId: membership.id, targetMembershipId: membership.id });
    },
    changeRole: async (teamId, membershipId, role, actorMembershipId, audit, options) => {
      const membership = rows.find(
        (m) => m.teamId === teamId && m.id === membershipId,
      );
      if (!membership) return { applied: false };
      if (options?.requireRemainingAdmin) {
        // Recomputed fresh at write time (not from a caller-supplied
        // snapshot) so concurrent writers cannot both observe a stale
        // admin count — mirrors the single conditional-UPDATE contract.
        const adminCount = rows.filter(
          (m) => m.teamId === teamId && m.role === "admin",
        ).length;
        if (adminCount <= 1) return { applied: false };
      }
      membership.role = role;
      audits.push({ ...audit, actorMembershipId, targetMembershipId: membershipId });
      return { applied: true };
    },
  };
}

export function fakeProfileRepo(): ProfileRepo & {
  rows: ProfileField[];
  audits: RecordedAudit[];
} {
  const rows: ProfileField[] = [];
  const audits: RecordedAudit[] = [];
  return {
    rows,
    audits,
    list: async (teamId: TeamId, membershipId?: MembershipId) =>
      rows.filter(
        (f) =>
          f.teamId === teamId &&
          (membershipId === undefined || f.membershipId === membershipId),
      ),
    upsertField: async (teamId, field, actorMembershipId, audit) => {
      const idx = rows.findIndex(
        (f) =>
          f.teamId === teamId &&
          f.membershipId === field.membershipId &&
          f.field === field.field,
      );
      if (idx >= 0) rows[idx] = field;
      else rows.push(field);
      audits.push({ ...audit, actorMembershipId, targetMembershipId: field.membershipId });
    },
  };
}

export function fakeDmSelectionRepo(): DmSelectionRepo & {
  rows: DmSelection[];
} {
  const rows: DmSelection[] = [];
  return {
    rows,
    get: async (telegramUserId) =>
      rows.find((s) => s.telegramUserId === telegramUserId) ?? null,
    set: async (selection) => {
      const idx = rows.findIndex(
        (s) => s.telegramUserId === selection.telegramUserId,
      );
      if (idx >= 0) rows[idx] = selection;
      else rows.push(selection);
    },
  };
}

export function fakeChatAdminChecker(
  admins: Array<{ chatId: number; userId: number }>,
  opts: { throws?: boolean } = {},
): ChatAdminChecker {
  return {
    isAdmin: async (chatId, userId) => {
      if (opts.throws) throw new Error("getChatMember failed");
      return admins.some((a) => a.chatId === chatId && a.userId === userId);
    },
  };
}

// GitHub alerts fakes (design.md "Interfaces / Contracts").

export function fakeGithubOrgClaimRepo(
  opts: { throws?: boolean } = {},
): GithubOrgClaimRepo & {
  rows: Array<{ teamId: TeamId; orgLogin: string }>;
} {
  const rows: Array<{ teamId: TeamId; orgLogin: string }> = [];
  return {
    rows,
    // Mirrors the D1 adapter (REL-001): claims are stored/keyed lowercase,
    // so both lookups normalize the input's case exactly like
    // createD1GithubOrgClaimRepo does.
    findTeamByOrg: async (orgLogin: string) => {
      if (opts.throws) throw new Error("D1 unavailable");
      const normalized = orgLogin.toLowerCase();
      return rows.find((r) => r.orgLogin === normalized)?.teamId ?? null;
    },
    isClaimedBy: async (teamId: TeamId, orgLogin: string) => {
      if (opts.throws) throw new Error("D1 unavailable");
      const normalized = orgLogin.toLowerCase();
      return rows.some((r) => r.teamId === teamId && r.orgLogin === normalized);
    },
  };
}

export function fakeRepoTopicLinkRepo(
  opts: { throws?: boolean } = {},
): RepoTopicLinkRepo & {
  rows: RepoTopicLink[];
} {
  const rows: RepoTopicLink[] = [];
  return {
    rows,
    get: async (teamId: TeamId, repo: RepoFullName) => {
      if (opts.throws) throw new Error("D1 unavailable");
      return (
        rows.find((l) => l.teamId === teamId && l.repoFullName === repo) ??
        null
      );
    },
    upsert: async (teamId: TeamId, link: RepoTopicLink) => {
      // Mirrors the D1 adapter (RISK-001/REL-002/READ-001): the `teamId`
      // argument is authoritative, a mismatching `link.teamId` is rejected
      // rather than silently written under the wrong team.
      if (teamId !== link.teamId) {
        throw new TenantMismatchError(
          `RepoTopicLinkRepo.upsert: teamId argument ("${teamId}") does not match link.teamId ("${link.teamId}")`,
        );
      }
      const idx = rows.findIndex(
        (l) => l.teamId === teamId && l.repoFullName === link.repoFullName,
      );
      if (idx >= 0) rows[idx] = link;
      else rows.push(link);
    },
    remove: async (teamId: TeamId, repo: RepoFullName) => {
      const idx = rows.findIndex(
        (l) => l.teamId === teamId && l.repoFullName === repo,
      );
      if (idx < 0) return false;
      rows.splice(idx, 1);
      return true;
    },
    list: async (teamId: TeamId) => rows.filter((l) => l.teamId === teamId),
  };
}

export function fakeAlertSender(
  opts: { throws?: boolean; failureClass?: AlertSendFailureClass } = {},
): AlertSender & {
  sent: Array<{ chatId: number; threadId: number; text: string }>;
} {
  const sent: Array<{ chatId: number; threadId: number; text: string }> = [];
  return {
    sent,
    send: async (chatId: number, threadId: number, text: string) => {
      if (opts.throws) {
        throw new AlertSendFailedError("sendMessage failed", opts.failureClass ?? "rejected");
      }
      sent.push({ chatId, threadId, text });
    },
  };
}

// --- Hackathon analysis fakes (PR2: every new port from design.md
// "Interfaces / Contracts") ---

// A scripted PageFetcher: each call consumes the next step (repeating the
// last one once the script is exhausted), so a test can drive a static
// fetch that succeeds with thin text followed by a rendered fetch that
// degrades, times out, or throws BrowserQuotaExceededError.
export type FetchStep = { text: string } | { throws: unknown };

export function fakePageFetcher(
  script: FetchStep[],
): PageFetcher & { calls: string[]; signals: AbortSignal[] } {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  let i = 0;
  return {
    calls,
    signals,
    fetch: async (url: string, signal: AbortSignal) => {
      calls.push(url);
      signals.push(signal);
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      if (!step) throw new Error("fakePageFetcher: empty script");
      if ("throws" in step) throw step.throws;
      return step.text;
    },
  };
}

export type ExtractStep = { raw: unknown; meta?: LlmOutputMeta } | { throws: unknown };

export function fakeLlmExtractor(
  script: ExtractStep[],
): LlmExtractor & {
  calls: Array<{ pageText: string; modelId: string; signal: AbortSignal }>;
} {
  const calls: Array<{ pageText: string; modelId: string; signal: AbortSignal }> = [];
  let i = 0;
  return {
    calls,
    extract: async (pageText: string, modelId: string, signal: AbortSignal) => {
      calls.push({ pageText, modelId, signal });
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      if (!step) throw new Error("fakeLlmExtractor: empty script");
      if ("throws" in step) throw step.throws;
      return step.meta !== undefined ? { value: step.raw, meta: step.meta } : { value: step.raw };
    },
  };
}

export function fakeHackathonAnalysisRepo(): HackathonAnalysisRepo & {
  rows: HackathonAnalysis[];
  // Live topic-claim expiry per analysis id (mirrors topic_claim_until).
  claims: Map<string, number>;
} {
  const rows: HackathonAnalysis[] = [];
  const claims = new Map<string, number>();
  return {
    rows,
    claims,
    // Mirrors the D1 CAS (single conditional UPDATE): wins only when the
    // observed thread id still matches and no live claim exists.
    claimTopicCreation: async (
      teamId: TeamId,
      analysisId: string,
      expectedThreadId: number | null,
      now: number,
      ttlMs: number,
    ) => {
      const row = rows.find((r) => r.teamId === teamId && r.id === analysisId);
      if (!row || row.threadId !== expectedThreadId) return false;
      if ((claims.get(analysisId) ?? 0) > now) return false;
      claims.set(analysisId, now + ttlMs);
      return true;
    },
    releaseTopicClaim: async (_teamId: TeamId, analysisId: string) => {
      claims.set(analysisId, 0);
    },
    setGeneralMessageId: async (teamId: TeamId, analysisId: string, messageId: number) => {
      const row = rows.find((r) => r.teamId === teamId && r.id === analysisId);
      if (row) row.generalMessageId = messageId;
    },
    findBySlug: async (teamId: TeamId, slug: string) =>
      rows.find((r) => r.teamId === teamId && r.slug === slug) ?? null,
    findById: async (teamId: TeamId, id: string) =>
      rows.find((r) => r.teamId === teamId && r.id === id) ?? null,
    findByNormalizedUrl: async (teamId: TeamId, normalizedUrl: string) =>
      rows.find(
        (r) => r.teamId === teamId && r.normalizedUrl === normalizedUrl,
      ) ?? null,
    findByThreadId: async (teamId: TeamId, threadId: number) =>
      rows.find((r) => r.teamId === teamId && r.threadId === threadId) ?? null,
    slugExists: async (teamId: TeamId, slug: string) =>
      rows.some((r) => r.teamId === teamId && r.slug === slug),
    save: async (analysis: HackathonAnalysis) => {
      // Mirrors the D1 upsert: it never writes general_message_id (nor
      // topic_claim_until, which lives in `claims`), so an update keeps the
      // stored value. The row is copied, never stored by reference.
      const idx = rows.findIndex((r) => r.id === analysis.id);
      if (idx >= 0) {
        rows[idx] = { ...analysis, generalMessageId: rows[idx]!.generalMessageId };
      } else {
        rows.push({ ...analysis });
      }
    },
    listByTeam: async (teamId: TeamId) => rows.filter((r) => r.teamId === teamId),
    moveTopicLink: async (
      teamId: TeamId,
      analysisId: string,
      threadId: number,
      pinnedMessageId: number | null,
    ) => {
      for (const row of rows) {
        if (row.teamId === teamId && row.threadId === threadId && row.id !== analysisId) {
          row.threadId = null;
          row.pinnedMessageId = null;
        }
      }
      const existing = rows.find((r) => r.teamId === teamId && r.id === analysisId);
      if (existing) {
        existing.threadId = threadId;
        existing.pinnedMessageId = pinnedMessageId;
      }
    },
    clearTopicLink: async (teamId: TeamId, analysisId: string) => {
      const existing = rows.find((r) => r.teamId === teamId && r.id === analysisId);
      if (existing) {
        existing.threadId = null;
        existing.pinnedMessageId = null;
      }
    },
  };
}

export function fakeAnalysisQuota(
  opts: { result?: "ok" | "busy" | "cap-reached" } = {},
): AnalysisQuota & {
  reserved: Array<Parameters<AnalysisQuota["reserve"]>[0]>;
  released: Array<{ team: TeamId; day: string; jobId: string; refund: boolean }>;
} {
  const reserved: Array<Parameters<AnalysisQuota["reserve"]>[0]> = [];
  const released: Array<{ team: TeamId; day: string; jobId: string; refund: boolean }> = [];
  return {
    reserved,
    released,
    reserve: async (input) => {
      reserved.push(input);
      return opts.result ?? "ok";
    },
    release: async (team: TeamId, day: string, jobId: string, refund: boolean) => {
      released.push({ team, day, jobId, refund });
    },
  };
}

export function fakeNlClassifyQuota(
  opts: { allow?: boolean } = {},
): NlClassifyQuota & {
  reserved: Array<{ teamId: TeamId; dayUtc: string; cap: number }>;
} {
  const reserved: Array<{ teamId: TeamId; dayUtc: string; cap: number }> = [];
  return {
    reserved,
    reserve: async (teamId, dayUtc, cap) => {
      reserved.push({ teamId, dayUtc, cap });
      return opts.allow ?? true;
    },
  };
}

export function fakeNlConfirmationRepo(): NlConfirmationRepo & {
  rows: NlConfirmation[];
} {
  const rows: NlConfirmation[] = [];
  return {
    rows,
    create: async (row) => {
      rows.push({ ...row, slots: { ...row.slots } });
    },
    findById: async (id) => rows.find((r) => r.id === id) ?? null,
    findByConfirmMessage: async (chatId, confirmMessageId) =>
      rows.find((r) => r.chatId === chatId && r.confirmMessageId === confirmMessageId) ?? null,
    tryConsume: async (id, now) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.consumedAt !== null || row.expiresAt <= now) return false;
      row.consumedAt = now;
      return true;
    },
    cancel: async (id, now) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.consumedAt !== null || row.expiresAt <= now) return false;
      row.consumedAt = now;
      return true;
    },
    updateSlots: async (id, slots) => {
      const row = rows.find((r) => r.id === id);
      if (row && row.consumedAt === null) row.slots = { ...slots };
    },
  };
}

export function fakeIntentClassifier(
  classifyFn?: (
    input: IntentClassifierInput,
  ) => IntentResult | Promise<IntentResult>,
): IntentClassifier & { calls: IntentClassifierInput[] } {
  const calls: IntentClassifierInput[] = [];
  return {
    calls,
    classify: async (input) => {
      calls.push(input);
      if (classifyFn) return classifyFn(input);
      const intent = stubNlIntent(input.text);
      return { intent, confidence: 0.9, slots: {} };
    },
  };
}

export function fakeAnalysisJobRepo(
  opts: {
    claimResult?: ClaimResult;
    // PR5 correction (RELI-001/RESI-001): paired with the SAME
    // fakeHackathonAnalysisRepo instance a test already holds, so
    // persistAnalysis records both effects together — the analysis upsert
    // and the job's persisted transition — mirroring the D1 adapter's
    // single db.batch (createD1AnalysisJobRepo.persistAnalysis).
    hackathonAnalysisRepo?: HackathonAnalysisRepo;
    // false models a job that is no longer `running` (claim lost): nothing
    // is written, mirroring the D1 adapter's guarded batch (FIXV-001).
    persistResult?: boolean;
  } = {},
): AnalysisJobRepo & {
  persisted: Array<{ id: string; analysisId: string }>;
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
} {
  const persisted: Array<{ id: string; analysisId: string }> = [];
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  return {
    persisted,
    succeeded,
    failed,
    claim: async () => opts.claimResult ?? { kind: "missing" },
    persistAnalysis: async (jobId: string, analysis: HackathonAnalysis) => {
      if (opts.persistResult === false) return false;
      persisted.push({ id: jobId, analysisId: analysis.id });
      await opts.hackathonAnalysisRepo?.save(analysis);
      return true;
    },
    markSucceeded: async (id: string) => {
      succeeded.push(id);
    },
    markFailed: async (id: string, reason: string) => {
      failed.push({ id, reason });
    },
  };
}

export function fakeAnalysisJobQueue(
  opts: { throws?: boolean } = {},
): AnalysisJobQueue & { sent: AnalysisJobMessage[] } {
  const sent: AnalysisJobMessage[] = [];
  return {
    sent,
    enqueue: async (message: AnalysisJobMessage) => {
      if (opts.throws) {
        throw new QueueSendFailedError("Queue.send failed");
      }
      sent.push(message);
    },
  };
}

export function fakeRepoMetadataSource(
  descriptions: Partial<Record<RepoFullName, string | null>> = {},
): RepoMetadataSource {
  return {
    fetchDescription: async (repo: RepoFullName) => descriptions[repo] ?? null,
  };
}

export function fakeChatPublisher(
  opts: {
    throws?: boolean;
    failureClass?: AlertSendFailureClass;
    // clearButtons fails (participation: a button-clear failure is ignored).
    clearThrows?: boolean;
  } = {},
): ChatPublisher & {
  posted: Array<{ chatId: number; threadId: number | null; text: string }>;
  // Parallel to `posted` (same index): the options each post received, so
  // the existing `posted` entry shape stays unchanged for older tests.
  postOptions: Array<PostOptions | undefined>;
  pinned: number[];
  unpinned: number[];
  cleared: Array<{ chatId: number; messageId: number }>;
  edited: Array<{ chatId: number; messageId: number; text: string; options?: PostOptions }>;
} {
  const posted: Array<{ chatId: number; threadId: number | null; text: string }> = [];
  const postOptions: Array<PostOptions | undefined> = [];
  const pinned: number[] = [];
  const unpinned: number[] = [];
  const cleared: Array<{ chatId: number; messageId: number }> = [];
  const edited: Array<{ chatId: number; messageId: number; text: string; options?: PostOptions }> = [];
  let nextMessageId = 1;
  return {
    posted,
    postOptions,
    pinned,
    unpinned,
    cleared,
    edited,
    post: async (chatId: number, threadId: number | null, text: string, options?: PostOptions) => {
      if (opts.throws) {
        throw new PublishFailedError("sendMessage failed", opts.failureClass ?? "rejected");
      }
      posted.push({ chatId, threadId, text });
      postOptions.push(options);
      return nextMessageId++;
    },
    clearButtons: async (chatId: number, messageId: number) => {
      if (opts.clearThrows) {
        throw new PublishFailedError("editMessageReplyMarkup failed", opts.failureClass ?? "rejected");
      }
      cleared.push({ chatId, messageId });
    },
    editMessage: async (chatId, messageId, text, options) => {
      if (opts.throws) {
        throw new PublishFailedError("editMessageText failed", opts.failureClass ?? "rejected");
      }
      edited.push({ chatId, messageId, text, options });
    },
    pin: async (_chatId: number, messageId: number) => {
      pinned.push(messageId);
    },
    unpin: async (_chatId: number, messageId: number) => {
      unpinned.push(messageId);
    },
  };
}

// Scripted ForumTopicManager: each call consumes the next outcome (repeating
// the last once exhausted); a default `create` yields sequential thread ids.
// `calls` logs every create so tests can assert "exactly one create".
export type TopicCreateStep = { threadId: number } | { fails: TopicCreateFailure };

export function fakeForumTopicManager(
  opts: { create?: TopicCreateStep[] } = {},
): ForumTopicManager & {
  created: Array<{ chatId: number; name: string; iconEmoji?: string; fallbackName?: string }>;
  closed: Array<{ chatId: number; threadId: number }>;
  reopened: Array<{ chatId: number; threadId: number }>;
} {
  const created: Array<{ chatId: number; name: string; iconEmoji?: string; fallbackName?: string }> = [];
  const closed: Array<{ chatId: number; threadId: number }> = [];
  const reopened: Array<{ chatId: number; threadId: number }> = [];
  let createIdx = 0;
  let nextThreadId = 1000;
  return {
    created,
    closed,
    reopened,
    create: async (chatId: number, name: string, hint?: TopicCreateOptions) => {
      created.push({ chatId, name, ...hint });
      const script = opts.create;
      const step = script && script.length > 0 ? script[Math.min(createIdx, script.length - 1)] : undefined;
      createIdx += 1;
      if (step && "fails" in step) {
        throw new ForumTopicCreateError("createForumTopic failed", step.fails);
      }
      return step ? step.threadId : nextThreadId++;
    },
    close: async (chatId: number, threadId: number) => {
      closed.push({ chatId, threadId });
    },
    reopen: async (chatId: number, threadId: number) => {
      reopened.push({ chatId, threadId });
    },
  };
}

export function membership(
  overrides: Partial<Membership> & {
    id: MembershipId;
    teamId: TeamId;
    memberId: MemberId;
  },
  role: Role = "member",
): Membership {
  return { role, joinedAt: 0, ...overrides };
}

// Records every structured log entry so tests can assert that a swallowed
// failure is still observable.
export function fakeLogger(): Logger & { entries: LogEvent[] } {
  const entries: LogEvent[] = [];
  return {
    entries,
    log: (entry: LogEvent) => {
      entries.push(entry);
    },
  };
}

// Records every requested delay and resolves at once (no real waiting).
// `onSleep` lets a test interleave the calls with other fakes' events.
export function fakeSleep(onSleep?: (ms: number) => void): Sleep & { calls: number[] } {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
    onSleep?.(ms);
  };
  return Object.assign(sleep, { calls });
}
