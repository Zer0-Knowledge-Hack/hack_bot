import type { MembershipId, TeamId } from "../ids";
import type { NlIntentId, NlSlots } from "./intents";
import { NL_MUTATE_INTENTS } from "./intents";

export const NL_CONFIRM_TTL_MS = 10 * 60 * 1000;

export type NlMutateIntentId =
  | "setup_team"
  | "join_team"
  | "bind_data_channel"
  | "set_profile_field"
  | "promote_member"
  | "demote_member"
  | "link_repo"
  | "unlink_repo"
  | "link_hackathon_topic"
  | "unlink_hackathon_topic"
  | "request_hackathon_analysis"
  | "participate_hackathon";

export function isNlMutateIntentId(intent: NlIntentId): intent is NlMutateIntentId {
  return NL_MUTATE_INTENTS.has(intent);
}

export interface NlConfirmation {
  id: string;
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  actorMembershipId: MembershipId;
  intent: NlMutateIntentId;
  slots: NlSlots;
  confirmMessageId: number | null;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

export function serializeNlSlots(slots: NlSlots): string {
  return JSON.stringify(slots);
}

export function parseNlSlotsJson(raw: string): NlSlots {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const obj = value as Record<string, unknown>;
    const slots: NlSlots = {};
    if (typeof obj.slug === "string" && obj.slug.trim() !== "") slots.slug = obj.slug.trim();
    if (typeof obj.url === "string" && obj.url.trim() !== "") slots.url = obj.url.trim();
    if (typeof obj.repo === "string" && obj.repo.trim() !== "") slots.repo = obj.repo.trim();
    if (typeof obj.membershipId === "string" && obj.membershipId.trim() !== "") {
      slots.membershipId = obj.membershipId.trim();
    }
    if (
      typeof obj.profileField === "string" &&
      (obj.profileField === "full_name" ||
        obj.profileField === "emails" ||
        obj.profileField === "social_links" ||
        obj.profileField === "github_username")
    ) {
      slots.profileField = obj.profileField;
    }
    if (typeof obj.profileValue === "string") slots.profileValue = obj.profileValue;
    if (typeof obj.targetName === "string" && obj.targetName.trim() !== "") {
      slots.targetName = obj.targetName.trim();
    }
    if (Array.isArray(obj.pickSlugs)) {
      const pickSlugs = obj.pickSlugs.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      );
      if (pickSlugs.length > 0) slots.pickSlugs = pickSlugs.map((s) => s.trim());
    }
    return slots;
  } catch {
    return {};
  }
}
