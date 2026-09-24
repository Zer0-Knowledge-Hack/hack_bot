# Key Backup & Secrets Setup

This bot cannot decrypt PII if `PII_KEYRING` is lost, and Cloudflare secrets
cannot be read back once set. Generate and back up the keyring **before**
running `wrangler secret put`, or the data becomes permanently unreadable.

## Quick path

1. Generate the full `PII_KEYRING` value offline, on a trusted machine:
   ```sh
   printf '{"active":1,"keys":{"1":"%s"}}\n' "$(openssl rand -base64 32)"
   ```
   It prints the whole JSON keyring, e.g. `{"active":1,"keys":{"1":"q2x...8Q="}}`.
   That whole line is the secret (see [Generate keyring](#generate-keyring)).
   > **Warning:** the secret must be this JSON, not the bare base64 key.
   > A raw `openssl rand -base64 32` output fails `parseKeyRing` ("not valid
   > JSON"), and every webhook request returns `500`.
2. Back up that exact JSON with two custodians in a password manager (see [Back up](#back-up-two-custodians)) — do this before step 3.
3. `wrangler secret put BOT_TOKEN`, `WEBHOOK_SECRET`, `PII_KEYRING` (see [Install secrets](#install-secrets)).
4. Register the webhook with `secret_token` and verify with `getWebhookInfo` (see [Register webhook](#register-webhook)).
5. Record who the two custodians are and which password-manager entry holds the secrets, somewhere your team can find during an incident (not in this repo).

## Generate keyring

`PII_KEYRING` is parsed by `src/adapters/crypto/key-ring.ts` (`parseKeyRing`).
The required shape is:

```json
{"active":1,"keys":{"1":"<base64 32-byte key>"}}
```

- `active` — the key version used to encrypt **new** writes (an integer).
- `keys` — a map from key-version string to a base64-encoded key. Each key
  MUST decode to exactly 32 bytes (AES-GCM-256). A wrong length throws.
- `active` MUST have a matching entry in `keys`. Any missing/malformed field
  fails closed (`buildBot` throws, the webhook returns 500) — it never falls
  back to plaintext or a wrong key.

Generate the full secret value offline, on a machine you trust, never in a
shared chat. The key only exists inside the command's output, never as a
literal in the command line or shell history:

```sh
printf '{"active":1,"keys":{"1":"%s"}}\n' "$(openssl rand -base64 32)"
```

Paste that whole JSON line (not only the key inside it) when
`wrangler secret put PII_KEYRING` prompts. Do not paste the key into any
online JSON tool. A bare base64 key is rejected: the Worker fails closed and
every webhook request returns `500`, with `"reason":"PII_KEYRING secret is not
valid JSON"` in the Worker logs.

## Back up (two custodians)

Cloudflare secrets are write-only — `wrangler secret put` cannot be reversed
to read the value back out. If you lose the keyring, you lose it for good, so
back it up **before** installing it as a Worker secret.

- Store the full `PII_KEYRING` JSON in a password manager entry shared by
  **two named custodians** (e.g. two maintainers), so no single person's
  device/account loss causes data loss.
- Also store `BOT_TOKEN` and `WEBHOOK_SECRET` the same way — they can be
  rotated without data loss, but re-issuing them still requires
  re-registering the webhook, so keeping them recoverable avoids downtime.
- Never commit any of these values to git, paste them into an issue/PR/chat
  message, or put them in `.dev.vars` outside your local machine (`.dev.vars`
  is already git-ignored; `.dev.vars.example` only holds placeholders).
- Never log these values. The codebase enforces this for PII field values
  (`src/adapters/log/safe-logger.ts`, allowlist-only fields) but there is no
  code-level guard against a human pasting a secret into a log line by
  hand — treat this as a hard rule during setup and incident response.

## Install secrets

The Worker reads these bindings (`src/env.ts`):

| Name | Kind | Set via |
|------|------|---------|
| `BOT_TOKEN` | secret | `wrangler secret put BOT_TOKEN` |
| `WEBHOOK_SECRET` | secret | `wrangler secret put WEBHOOK_SECRET` |
| `PII_KEYRING` | secret | `wrangler secret put PII_KEYRING` |
| `BOT_INFO` | var (not sensitive — grammY's cached `getMe` result) | plain wrangler var / `.dev.vars` locally |
| `DB` | D1 binding | `wrangler.jsonc` `d1_databases` (already configured) |

```sh
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put PII_KEYRING
```

Each command prompts for the value interactively — paste it at the prompt. Never
put a secret in the command line itself (including `echo "<value>" | ...`),
since the command line persists in shell history.

`WEBHOOK_SECRET` must match Telegram's `secret_token` constraint: 1–256
characters, `A-Z a-z 0-9 _ -` only. Generate one with, for example:

```sh
openssl rand -hex 32
```

`BOT_INFO` is not secret (it is grammY's own `getMe` response, cached to
avoid one extra API call per request — `src/adapters/telegram/bot.ts`); set
it as a normal `vars` entry in `wrangler.jsonc` or `.dev.vars` locally, not
via `wrangler secret put`.

## Register webhook

The bot listens on `POST /telegram/webhook` and validates the
`X-Telegram-Bot-Api-Secret-Token` header with a constant-time comparison
before parsing the body (`src/index.ts`). Register the same value as
`secret_token` when calling Telegram's `setWebhook`:

```sh
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-worker-domain>/telegram/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

Verify it took effect:

```sh
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

Confirm `url` matches your Worker and `last_error_message` is empty. A
missing or mismatched header on an incoming request is rejected with
`401 Unauthorized` before any body parsing happens.

## Rotation

### `PII_KEYRING` (adding a new key version)

The schema and cipher support multiple key versions, but **this change ships
no re-encryption job** — rotation only adds a version, it never rewrites
existing rows:

1. Add a new entry under `keys` (e.g. `"2": "<new base64 32-byte key>"`).
2. Set `active` to the new version.
3. `wrangler secret put PII_KEYRING` with the updated JSON (keep the old key
   entries — do not remove them).

After this, new writes are encrypted under the new `active` version; each
`profile_fields` / `audit_log` row stores its own `key_version`, so
previously-written rows keep decrypting with their original key
(`src/adapters/crypto/aes-gcm-cipher.ts` looks up the key by the row's stored
version, not the current `active` one).

Never remove a key version from `keys` while any row still references it —
doing so makes those rows permanently `unreadable` (see
[Recovery](#recovery-lost-or-corrupted-keyring) below). There is no built-in
way to know which versions are still referenced without querying
`profile_fields`/`audit_log` directly.

### `WEBHOOK_SECRET` / `BOT_TOKEN`

Rotating these does not affect stored data. Update the secret, then
re-register the webhook (Register webhook, above) with the new value —
Telegram does not pick up a changed `secret_token` or token until
`setWebhook` is called again.

## Recovery: lost or corrupted keyring

If `PII_KEYRING` is lost entirely, or the active version's key no longer
matches what was used to encrypt existing rows, **that data cannot be
recovered** — there is no backdoor or master key.

- On a missing/malformed `PII_KEYRING` secret, `parseKeyRing` throws and the
  whole Worker fails closed: every webhook request returns `500` until the
  secret is fixed (`src/index.ts` catches the `buildBot` failure).
- On a corrupted/wrong-key single field, decryption fails per-field, not for
  the whole request: `src/adapters/d1/profile-repo.ts` catches
  `FieldUnreadableError` and returns that field marked `unreadable: true`
  with an empty value, instead of failing the whole listing.
- Plaintext data — teams, roles, membership, GitHub usernames — is
  unaffected either way.
- The only recovery path for lost PII fields is for the affected member to
  re-enter them once the correct keyring (or a fresh one, for new data) is
  installed.

## Final checklist

- [ ] Keyring generated offline as the full JSON (`{"active":1,"keys":{"1":"<base64 32-byte key>"}}`), not a bare base64 key.
- [ ] `PII_KEYRING` JSON backed up in a password manager shared by two custodians, before `wrangler secret put`.
- [ ] `BOT_TOKEN` and `WEBHOOK_SECRET` also backed up with the two custodians.
- [ ] `wrangler secret put` run for `BOT_TOKEN`, `WEBHOOK_SECRET`, `PII_KEYRING`.
- [ ] `BOT_INFO` set as a plain var (not a secret).
- [ ] `setWebhook` called with matching `secret_token`; `getWebhookInfo` confirms the URL and shows no `last_error_message`.
- [ ] Rotation plan understood: adding a key version is supported, deleting one that is still referenced is not — it makes those rows unrecoverable.
