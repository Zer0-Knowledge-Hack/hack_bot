import type { NlMutateIntentId } from "./confirmation";
import type { NlSlots } from "./intents";

export interface NlConfirmSummaries {
  setup_team: string;
  join_team: string;
  bind_data_channel: string;
  set_profile_field: (field: string) => string;
  promote_member: (id: string) => string;
  demote_member: (id: string) => string;
  link_repo: (repo: string) => string;
  unlink_repo: (repo: string) => string;
  link_hackathon_topic: (slug: string) => string;
  request_hackathon_analysis: string;
  participate_hackathon: (slug: string) => string;
}

// Builds a human-readable confirm action summary. Never includes profileValue.
export function confirmSummaryFor(
  intent: NlMutateIntentId,
  slots: NlSlots,
  summaries: NlConfirmSummaries,
): string | null {
  switch (intent) {
    case "setup_team":
      return summaries.setup_team;
    case "join_team":
      return summaries.join_team;
    case "bind_data_channel":
      return summaries.bind_data_channel;
    case "set_profile_field":
      return slots.profileField ? summaries.set_profile_field(slots.profileField) : null;
    case "promote_member":
      return slots.membershipId ? summaries.promote_member(slots.membershipId) : null;
    case "demote_member":
      return slots.membershipId ? summaries.demote_member(slots.membershipId) : null;
    case "link_repo":
      return slots.repo ? summaries.link_repo(slots.repo) : null;
    case "unlink_repo":
      return slots.repo ? summaries.unlink_repo(slots.repo) : null;
    case "link_hackathon_topic":
      return slots.slug ? summaries.link_hackathon_topic(slots.slug) : null;
    case "request_hackathon_analysis":
      return slots.url ? summaries.request_hackathon_analysis : null;
    case "participate_hackathon":
      return slots.slug ? summaries.participate_hackathon(slots.slug) : null;
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}
