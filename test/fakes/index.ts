import { AlertSendFailedError } from "../../src/domain/errors";
import type {
  AuditDraft,
  Member,
  Membership,
  ProfileField,
  RepoTopicLink,
  Role,
  DmSelection,
  Team,
} from "../../src/domain/entities";
import type { RepoFullName } from "../../src/domain/github";
import type {
  AlertSender,
  ChatAdminChecker,
  Clock,
  DmSelectionRepo,
  GithubOrgClaimRepo,
  IdGen,
  MemberRepo,
  MembershipRepo,
  ProfileRepo,
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
    findTeamByOrg: async (orgLogin: string) => {
      if (opts.throws) throw new Error("D1 unavailable");
      return rows.find((r) => r.orgLogin === orgLogin)?.teamId ?? null;
    },
    isClaimedBy: async (teamId: TeamId, orgLogin: string) => {
      if (opts.throws) throw new Error("D1 unavailable");
      return rows.some((r) => r.teamId === teamId && r.orgLogin === orgLogin);
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
  opts: { throws?: boolean } = {},
): AlertSender & {
  sent: Array<{ chatId: number; threadId: number; text: string }>;
} {
  const sent: Array<{ chatId: number; threadId: number; text: string }> = [];
  return {
    sent,
    send: async (chatId: number, threadId: number, text: string) => {
      if (opts.throws) throw new AlertSendFailedError("sendMessage failed");
      sent.push({ chatId, threadId, text });
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
