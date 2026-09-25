import { Api } from "grammy";
import { createAesGcmCipher } from "./adapters/crypto/aes-gcm-cipher";
import { parseKeyRing } from "./adapters/crypto/key-ring";
import { createD1DmSelectionRepo } from "./adapters/d1/dm-selection-repo";
import { createD1GithubOrgClaimRepo } from "./adapters/d1/github-org-claim-repo";
import { createD1MemberRepo } from "./adapters/d1/member-repo";
import { createD1MembershipRepo } from "./adapters/d1/membership-repo";
import { createD1ProfileRepo } from "./adapters/d1/profile-repo";
import { createD1RepoTopicLinkRepo } from "./adapters/d1/repo-topic-link-repo";
import { createD1TeamRepo } from "./adapters/d1/team-repo";
import { createSafeLogger } from "./adapters/log/safe-logger";
import { createTelegramAlertSender } from "./adapters/telegram/alert-sender";
import { createBot } from "./adapters/telegram/bot";
import { createChatAdminChecker } from "./adapters/telegram/chat-admin-checker";
import { registerCommands } from "./adapters/telegram/commands";
import { ConfigError } from "./config-error";
import type { FieldCipher } from "./domain/ports";
import type { RouteGithubEventDeps } from "./domain/usecases/route-github-event";
import type { UserFromGetMe } from "grammy/types";
import type { Env } from "./env";

// Composition root: wires env bindings -> adapters -> use cases for one
// request (design.md "src/composition.ts"). No module-level mutable
// request state, with ONE deliberate exception: `PII_KEYRING` parsing and
// the AES-GCM cipher it builds are cached per isolate, keyed by the raw
// secret value, so keys are not re-imported on every request
// (workers-best-practices "module-level mutable request state" is about
// request-scoped data — a secret's derived key material is isolate-scoped
// and immutable for the isolate's lifetime, which is the intended
// exception here).
const cipherCache = new Map<string, FieldCipher>();

function getOrBuildCipher(rawKeyRing: string): FieldCipher {
  const cached = cipherCache.get(rawKeyRing);
  if (cached) return cached;
  // parseKeyRing / createAesGcmCipher throw on a missing or malformed
  // secret — fail closed. A failed build is never cached, so a later
  // request with a corrected secret is not stuck on the earlier failure.
  const cipher = createAesGcmCipher(parseKeyRing(rawKeyRing));
  cipherCache.set(rawKeyRing, cipher);
  return cipher;
}

// Plain function values, not classes with hidden state — safe to reuse
// across requests since neither closes over any request-specific value.
const idGen = { newId: () => crypto.randomUUID() };
const clock = { now: () => Date.now() };

// A raw JSON.parse SyntaxError can quote the input, so it is replaced by a
// ConfigError with a fixed message that is safe to log. The shape check
// covers the fields grammY reads from its cached getMe result (the bot's
// id, and its username for command matching).
function parseBotInfo(raw: string): UserFromGetMe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("BOT_INFO var is not valid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { id?: unknown }).id !== "number" ||
    typeof (parsed as { username?: unknown }).username !== "string"
  ) {
    throw new ConfigError(
      "BOT_INFO var must be a getMe object with a numeric id and a string username",
    );
  }
  return parsed as UserFromGetMe;
}

export function buildBot(env: Env) {
  const cipher = getOrBuildCipher(env.PII_KEYRING);
  const logger = createSafeLogger();

  const teamRepo = createD1TeamRepo(env.DB, idGen, clock);
  const memberRepo = createD1MemberRepo(env.DB);
  const membershipRepo = createD1MembershipRepo(env.DB, idGen, clock);
  const profileRepo = createD1ProfileRepo(env.DB, idGen, clock, cipher);
  const dmSelectionRepo = createD1DmSelectionRepo(env.DB);

  const bot = createBot(env.BOT_TOKEN, parseBotInfo(env.BOT_INFO));
  const chatAdminChecker = createChatAdminChecker(bot.api);

  registerCommands(bot, {
    teamRepo,
    memberRepo,
    membershipRepo,
    profileRepo,
    dmSelectionRepo,
    chatAdminChecker,
    clock,
    idGen,
    logger,
  });

  return bot;
}

// design.md "Sender": `new Api(BOT_TOKEN)` here, no `Bot` and no
// `PII_KEYRING` on this route — a broken keyring would otherwise break
// GitHub alerts too, and this composition path never touches PII fields.
export function buildGithubRouter(env: Env): RouteGithubEventDeps {
  const api = new Api(env.BOT_TOKEN);

  return {
    githubOrgClaimRepo: createD1GithubOrgClaimRepo(env.DB),
    repoTopicLinkRepo: createD1RepoTopicLinkRepo(env.DB),
    teamRepo: createD1TeamRepo(env.DB, idGen, clock),
    alertSender: createTelegramAlertSender(api),
  };
}
