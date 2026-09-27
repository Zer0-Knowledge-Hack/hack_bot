import {
  AlertSendFailedError,
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
  DmSelectionRepo,
  GithubOrgClaimRepo,
  HackathonAnalysisRepo,
  IdGen,
  LogEvent,
  Logger,
  LlmExtractor,
  MemberRepo,
  MembershipRepo,
  PageFetcher,
  ProfileRepo,
  RepoMetadataSource,
  RepoTopicLinkRepo,
  TeamRepo,
} from "../../src/domain/ports";
import type { MemberId, MembershipId, TeamId } from "../../src/domain/ids";

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

export type ExtractStep = { raw: unknown } | { throws: unknown };

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
      return step.raw;
    },
  };
}

export function fakeHackathonAnalysisRepo(): HackathonAnalysisRepo & {
  rows: HackathonAnalysis[];
} {
  const rows: HackathonAnalysis[] = [];
  return {
    rows,
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
      const idx = rows.findIndex((r) => r.id === analysis.id);
      if (idx >= 0) rows[idx] = analysis;
      else rows.push(analysis);
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

export function fakeAnalysisJobRepo(
  opts: { claimResult?: ClaimResult } = {},
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
    markPersisted: async (id: string, analysisId: string) => {
      persisted.push({ id, analysisId });
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
  opts: { throws?: boolean; failureClass?: AlertSendFailureClass } = {},
): ChatPublisher & {
  posted: Array<{ chatId: number; threadId: number | null; text: string }>;
  pinned: number[];
  unpinned: number[];
} {
  const posted: Array<{ chatId: number; threadId: number | null; text: string }> = [];
  const pinned: number[] = [];
  const unpinned: number[] = [];
  let nextMessageId = 1;
  return {
    posted,
    pinned,
    unpinned,
    post: async (chatId: number, threadId: number | null, text: string) => {
      if (opts.throws) {
        throw new PublishFailedError("sendMessage failed", opts.failureClass ?? "rejected");
      }
      posted.push({ chatId, threadId, text });
      return nextMessageId++;
    },
    pin: async (_chatId: number, messageId: number) => {
      pinned.push(messageId);
    },
    unpin: async (_chatId: number, messageId: number) => {
      unpinned.push(messageId);
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
