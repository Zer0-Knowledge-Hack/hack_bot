import type {
  AuditDraft,
  Member,
  Membership,
  ProfileField,
  Role,
  DmSelection,
  Team,
} from "../../src/domain/entities";
import type {
  ChatAdminChecker,
  Clock,
  DmSelectionRepo,
  IdGen,
  MemberRepo,
  MembershipRepo,
  ProfileRepo,
  TeamRepo,
} from "../../src/domain/ports";
import type { MemberId, MembershipId, TeamId } from "../../src/domain/ids";

// In-memory fakes for domain tests. Pure Vitest, no Workers runtime needed —
// this proves the domain layer has zero infrastructure dependencies.

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
  audits: AuditDraft[];
} {
  const rows: Team[] = [];
  const audits: AuditDraft[] = [];
  return {
    rows,
    audits,
    findByChatId: async (chatId) =>
      rows.find((t) => t.chatId === chatId) ?? null,
    get: async (teamId) => rows.find((t) => t.id === teamId) ?? null,
    create: async (team) => {
      rows.push(team);
    },
    bindDataChannel: async (teamId, threadId, audit) => {
      const team = rows.find((t) => t.id === teamId);
      if (team) team.dataTopicThreadId = threadId;
      audits.push(audit);
    },
  };
}

export function fakeMemberRepo(): MemberRepo & { rows: Member[] } {
  const rows: Member[] = [];
  return {
    rows,
    findByTelegramUserId: async (telegramUserId) =>
      rows.find((m) => m.telegramUserId === telegramUserId) ?? null,
    upsert: async (member) => {
      const idx = rows.findIndex((m) => m.id === member.id);
      if (idx >= 0) rows[idx] = member;
      else rows.push(member);
    },
  };
}

// `memberRepo` is used to resolve telegramUserId -> memberId for
// `findByUser`, mirroring how the real D1 repo would join through members.
export function fakeMembershipRepo(
  memberRepo: MemberRepo & { rows: Member[] },
): MembershipRepo & { rows: Membership[]; audits: AuditDraft[] } {
  const rows: Membership[] = [];
  const audits: AuditDraft[] = [];
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
      audits.push(audit);
    },
    changeRole: async (teamId, membershipId, role, audit, options) => {
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
      audits.push(audit);
      return { applied: true };
    },
  };
}

export function fakeProfileRepo(): ProfileRepo & {
  rows: ProfileField[];
  audits: AuditDraft[];
} {
  const rows: ProfileField[] = [];
  const audits: AuditDraft[] = [];
  return {
    rows,
    audits,
    list: async (teamId: TeamId, membershipId?: MembershipId) =>
      rows.filter(
        (f) =>
          f.teamId === teamId &&
          (membershipId === undefined || f.membershipId === membershipId),
      ),
    upsertField: async (teamId, field, audit) => {
      const idx = rows.findIndex(
        (f) =>
          f.teamId === teamId &&
          f.membershipId === field.membershipId &&
          f.field === field.field,
      );
      if (idx >= 0) rows[idx] = field;
      else rows.push(field);
      audits.push(audit);
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
