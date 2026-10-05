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
    return value as NlSlots;
  } catch {
    return {};
  }
}
