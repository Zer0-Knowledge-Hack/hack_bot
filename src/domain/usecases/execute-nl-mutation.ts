import type { NlMutateIntentId } from "../nl/confirmation";
import type { NlSlots } from "../nl/intents";
import { asMembershipId } from "../ids";
import {
  AnalysisNotFoundError,
  AlreadyExistsError,
  ChatAdminCheckFailedError,
  LastAdminError,
  NotFoundError,
  OrgNotClaimedError,
  UnauthorizedError,
  UnsafeUrlError,
} from "../errors";
import type {
  AnalysisJobQueue,
  AnalysisJobRepo,
  AnalysisQuota,
  ChatAdminChecker,
  ChatPublisher,
  Clock,
  ForumTopicManager,
  GithubOrgClaimRepo,
  HackathonAnalysisRepo,
  IdGen,
  MemberRepo,
  MembershipRepo,
  ProfileRepo,
  RepoTopicLinkRepo,
  Sleep,
  TeamRepo,
  Logger,
} from "../ports";
import { setupTeam } from "./setup-team";
import { joinTeam } from "./join-team";
import { bindDataChannel } from "./bind-data-channel";
import { updateProfileField } from "./update-profile-field";
import { changeRole } from "./change-role";
import { linkRepoToTopic } from "./link-repo-to-topic";
import { unlinkRepo } from "./unlink-repo";
import { linkAnalysisToTopic } from "./link-analysis-to-topic";
import { requestHackathonAnalysis } from "./request-hackathon-analysis";
import { participateInHackathon } from "./participate-in-hackathon";
import { parseRepoReference } from "../github";
import { assertSafeUrl } from "../hackathon/url";
import type { ProfileFieldName } from "../entities";

export interface ExecuteNlMutationInput {
  intent: NlMutateIntentId;
  slots: NlSlots;
  teamId: import("../ids").TeamId;
  actorMembershipId: import("../ids").MembershipId;
  chatId: number;
  threadId: number | null;
  callerTelegramUserId: number;
  callbackMessageId: number | null;
}

export interface ExecuteNlMutationDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  chatAdminChecker: ChatAdminChecker;
  githubOrgClaimRepo: GithubOrgClaimRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  analysisQuota: AnalysisQuota;
  analysisJobRepo: AnalysisJobRepo;
  analysisJobQueue: AnalysisJobQueue;
  chatPublisher: ChatPublisher;
  forumTopicManager: ForumTopicManager;
  sleep: Sleep;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
}

export interface ExecuteNlMutationResult {
  replyText: string;
}

const PROFILE_FIELDS = new Set<ProfileFieldName>([
  "full_name",
  "emails",
  "social_links",
  "github_username",
]);

// Runs the existing use case for a confirmed mutate intent. Authorization is
// re-checked inside each use case (never trust classifier slots alone).
export async function executeNlMutation(
  input: ExecuteNlMutationInput,
  deps: ExecuteNlMutationDeps,
): Promise<ExecuteNlMutationResult> {
  switch (input.intent) {
    case "setup_team": {
      await setupTeam(
        { chatId: input.chatId, callerTelegramUserId: input.callerTelegramUserId },
        deps,
      );
      return { replyText: "Equipo creado. Eres el primer administrador." };
    }
    case "join_team": {
      await joinTeam(
        { chatId: input.chatId, callerTelegramUserId: input.callerTelegramUserId },
        deps,
      );
      return { replyText: "Te uniste al equipo." };
    }
    case "bind_data_channel": {
      if (input.threadId === null) throw new UnauthorizedError("Topic required");
      await bindDataChannel(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          threadId: input.threadId,
        },
        deps,
      );
      return { replyText: "Este tema es ahora el canal de datos del equipo." };
    }
    case "set_profile_field": {
      const field = input.slots.profileField;
      const value = input.slots.profileValue;
      if (!field || value === undefined || !PROFILE_FIELDS.has(field)) {
        throw new NotFoundError("Profile field incomplete");
      }
      await updateProfileField(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          targetMembershipId: input.actorMembershipId,
          field,
          value,
          keyVersion: null,
        },
        deps,
      );
      return { replyText: `Perfil actualizado (${field}).` };
    }
    case "promote_member":
    case "demote_member": {
      const target = input.slots.membershipId;
      if (!target) throw new NotFoundError("Target membership required");
      const newRole = input.intent === "promote_member" ? "admin" : "member";
      await changeRole(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          targetMembershipId: asMembershipId(target),
          newRole,
        },
        deps,
      );
      return {
        replyText:
          newRole === "admin"
            ? "Miembro promovido a administrador."
            : "Administrador dejado como miembro.",
      };
    }
    case "link_repo": {
      if (input.threadId === null) throw new UnauthorizedError("Topic required");
      const repo = input.slots.repo ? parseRepoReference(input.slots.repo) : null;
      if (!repo) throw new NotFoundError("Repo required");
      await linkRepoToTopic(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          threadId: input.threadId,
          repo,
        },
        deps,
      );
      return { replyText: `Se vinculó ${repo} a este tema.` };
    }
    case "unlink_repo": {
      const repo = input.slots.repo ? parseRepoReference(input.slots.repo) : null;
      if (!repo) throw new NotFoundError("Repo required");
      const removed = await unlinkRepo(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          repo,
        },
        deps,
      );
      return {
        replyText: removed
          ? `Se desvinculó ${repo} de este tema.`
          : `${repo} no estaba vinculado a ningún tema.`,
      };
    }
    case "link_hackathon_topic": {
      if (input.threadId === null) throw new UnauthorizedError("Topic required");
      const slug = input.slots.slug?.trim();
      if (!slug) throw new AnalysisNotFoundError("Slug required");
      const linked = await linkAnalysisToTopic(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          chatId: input.chatId,
          threadId: input.threadId,
          slug,
        },
        deps,
      );
      return {
        replyText:
          linked.notes.length > 0 ? linked.notes.join("\n") : `Se vinculó ${slug} a este tema.`,
      };
    }
    case "request_hackathon_analysis": {
      const rawUrl = input.slots.url?.trim();
      if (!rawUrl) throw new UnsafeUrlError("URL required", "missing");
      const guard = assertSafeUrl(rawUrl);
      if (!guard.ok) throw new UnsafeUrlError("URL failed the safety guard", guard.reason);
      const result = await requestHackathonAnalysis(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          chatId: input.chatId,
          threadId: input.threadId,
          sourceUrl: guard.url.href,
        },
        deps,
      );
      return { replyText: result.replyText };
    }
    case "participate_hackathon": {
      const slug = input.slots.slug?.trim();
      if (!slug) throw new AnalysisNotFoundError("Slug required");
      const result = await participateInHackathon(
        {
          teamId: input.teamId,
          actorMembershipId: input.actorMembershipId,
          chatId: input.chatId,
          slug,
          callbackMessageId: input.callbackMessageId,
        },
        deps,
      );
      return { replyText: result.replyText ?? "Listo." };
    }
    default: {
      const _exhaustive: never = input.intent;
      return _exhaustive;
    }
  }
}

export function mapMutationErrorToCode(err: unknown): string {
  if (
    err instanceof UnauthorizedError ||
    err instanceof NotFoundError ||
    err instanceof AlreadyExistsError ||
    err instanceof LastAdminError ||
    err instanceof ChatAdminCheckFailedError ||
    err instanceof AnalysisNotFoundError ||
    err instanceof UnsafeUrlError ||
    err instanceof OrgNotClaimedError
  ) {
    return err.name;
  }
  return err instanceof Error ? err.name : "UnknownError";
}
