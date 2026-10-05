// Closed NL intent enum + slots (natural-language-text design.md).

export const NL_CLASSIFY_DAILY_CAP = 100;
export const NL_CONFIDENCE_FLOOR = 0.55;
export const NL_CLASSIFY_TIMEOUT_MS = 15_000;

export const NL_INTENT_IDS = [
  "help",
  "setup_team",
  "join_team",
  "bind_data_channel",
  "show_profiles",
  "set_profile_field",
  "promote_member",
  "demote_member",
  "link_repo",
  "unlink_repo",
  "list_repos",
  "list_hackathons",
  "show_hackathon",
  "link_hackathon_topic",
  "unlink_hackathon_topic",
  "request_hackathon_analysis",
  "show_topic_hackathon",
  "participate_hackathon",
  "unknown",
] as const;

export type NlIntentId = (typeof NL_INTENT_IDS)[number];

export const NL_READ_INTENTS = new Set<NlIntentId>([
  "help",
  "show_profiles",
  "list_repos",
  "list_hackathons",
  "show_hackathon",
  "show_topic_hackathon",
  "unknown",
]);

export const NL_MUTATE_INTENTS = new Set<NlIntentId>([
  "setup_team",
  "join_team",
  "bind_data_channel",
  "set_profile_field",
  "promote_member",
  "demote_member",
  "link_repo",
  "unlink_repo",
  "link_hackathon_topic",
  "unlink_hackathon_topic",
  "request_hackathon_analysis",
  "participate_hackathon",
]);

export type NlSlots = {
  slug?: string;
  url?: string;
  repo?: string;
  membershipId?: string;
  profileField?: "full_name" | "emails" | "social_links" | "github_username";
  profileValue?: string;
  targetName?: string;
  // Pending multi-match pick for unlink (and later other slug intents).
  pickSlugs?: string[];
};

export interface IntentClassifierInput {
  text: string;
  localeHint: "es";
  context: {
    inTopic: boolean;
    inDataChannel: boolean;
    replyKind?: "bot-analysis" | "bot-confirm" | "bot-other" | "user" | "none";
  };
}

export interface IntentResult {
  intent: NlIntentId;
  confidence: number;
  slots: NlSlots;
}

const INTENT_SET = new Set<string>(NL_INTENT_IDS);

const PROFILE_FIELDS = new Set([
  "full_name",
  "emails",
  "social_links",
  "github_username",
]);

export function isNlIntentId(value: unknown): value is NlIntentId {
  return typeof value === "string" && INTENT_SET.has(value);
}

// Pure parse + confidence gate for model JSON (design.md decision 9).
// Invalid intent ids / low confidence ⇒ unknown. Bad shape ⇒ null (caller
// maps to IntentClassificationError).
export function parseIntentResult(raw: unknown): IntentResult | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const intentRaw = obj.intent;
  if (!isNlIntentId(intentRaw)) {
    return { intent: "unknown", confidence: 0, slots: {} };
  }

  const confidenceRaw = obj.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? confidenceRaw
      : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < NL_CONFIDENCE_FLOOR) {
    return { intent: "unknown", confidence: Number.isFinite(confidence) ? confidence : 0, slots: {} };
  }

  return {
    intent: intentRaw,
    confidence,
    slots: parseSlots(obj.slots),
  };
}

function parseSlots(raw: unknown): NlSlots {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const slots: NlSlots = {};
  if (typeof obj.slug === "string" && obj.slug.trim() !== "") {
    slots.slug = obj.slug.trim();
  }
  if (typeof obj.url === "string" && obj.url.trim() !== "") {
    slots.url = obj.url.trim();
  }
  if (typeof obj.repo === "string" && obj.repo.trim() !== "") {
    slots.repo = obj.repo.trim();
  }
  if (typeof obj.membershipId === "string" && obj.membershipId.trim() !== "") {
    slots.membershipId = obj.membershipId.trim();
  }
  if (typeof obj.profileField === "string" && PROFILE_FIELDS.has(obj.profileField)) {
    slots.profileField = obj.profileField as NlSlots["profileField"];
  }
  if (typeof obj.profileValue === "string") {
    slots.profileValue = obj.profileValue;
  }
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
}

export function utcDayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function confidenceBucket(confidence: number): "low" | "mid" | "high" {
  if (confidence < NL_CONFIDENCE_FLOOR) return "low";
  if (confidence < 0.8) return "mid";
  return "high";
}
