# Hackathon Participation Specification

## Purpose

Lets a team admin confirm, in one action, that the team participates in an analyzed hackathon: the bot creates a forum topic, links and pins the analysis there, and announces it in General. Bot copy is Spanish per `bot-copy`; extracted values stay verbatim.

## Requirements

### Requirement: Two Triggers, One Behavior

The system MUST let an admin confirm participation by tapping the "✅ Participamos" inline button (callback data `hp:<slug>`, at most 64 bytes) or by running `/hackathon join <slug>`. Both triggers MUST produce identical effects. The team MUST be resolved from the chat id, never from the payload.

#### Scenario: Admin taps the button

- GIVEN an analysis `meridian` without a topic and the caller is a team admin
- WHEN they tap "✅ Participamos" (`hp:meridian`)
- THEN a topic is created, linked and pinned as specified below

#### Scenario: Admin uses the command for an old analysis

- GIVEN an analysis `meridian` posted before buttons existed
- WHEN an admin runs `/hackathon join meridian`
- THEN the outcome is identical to tapping the button
- AND the removal of the original message's button is best-effort (the message may be unknown)

#### Scenario: Unknown slug

- GIVEN no analysis `nope` exists for the team
- WHEN an admin runs `/hackathon join nope`
- THEN the system replies "No se encontró ningún análisis con el slug nope." and creates nothing

#### Scenario: Join without slug

- WHEN an admin runs `/hackathon join`
- THEN the system replies "Uso: /hackathon join <slug>"

### Requirement: Admins Only

The system MUST allow only a team admin to confirm participation and MUST change nothing for anyone else.

#### Scenario: Non-admin taps the button

- GIVEN the caller is not a team admin
- WHEN they tap "✅ Participamos"
- THEN a callback alert reads "Solo un administrador del equipo puede confirmar la participación."
- AND no topic is created, nothing is persisted and the button stays

#### Scenario: Non-admin runs the command

- GIVEN the caller is not a team admin
- WHEN they run `/hackathon join <slug>`
- THEN the system replies "Solo un administrador del equipo puede confirmar la participación." and changes nothing

### Requirement: Topic Creation and Naming

The system MUST create the topic named `<name>` (no emoji) and set 🏆 as the topic icon through `icon_custom_emoji_id`, taken from Telegram's topic icon set. Only when the icon cannot be applied (no matching icon, or the icon list is unavailable) MUST the name carry the visible fallback prefix `🏆 <name>`. Here `<name>` is the extracted `fields.name.value`, or the slug when there is no name. The name is untrusted: control characters MUST be removed, whitespace collapsed, and the full topic name MUST be 1–128 characters. The name is otherwise verbatim.

#### Scenario: Name from the page

- GIVEN `fields.name.value` is "Meridian  Hack\n2026"
- WHEN participation is confirmed
- THEN the topic is named "Meridian Hack 2026"
- AND the topic icon is 🏆

#### Scenario: Icon unavailable

- GIVEN Telegram has no matching topic icon, or the icon list cannot be fetched
- WHEN participation is confirmed
- THEN the topic is still created, named "🏆 Meridian Hack 2026" with no icon

#### Scenario: Fresh topic is paced

- GIVEN the topic was just created
- WHEN the analysis is posted and pinned
- THEN the system waits about 1.5 s before the post and about 1 s between the post and the pin
- AND a live-topic check never waits

#### Scenario: Missing or empty name

- GIVEN `fields.name.value` is absent or empty after sanitizing
- WHEN participation is confirmed
- THEN the topic is named "<slug>"

#### Scenario: Overlong name

- GIVEN the sanitized name would exceed the limit
- WHEN participation is confirmed
- THEN the topic name is truncated to at most 128 characters

### Requirement: Live Topic Is Idempotent

The system MUST NOT create a topic when the analysis is linked to a live topic. It MUST reply with the topic link.

#### Scenario: Second confirmation

- GIVEN `meridian` is linked to a live topic
- WHEN an admin confirms participation again
- THEN the system replies "Este hackathon ya tiene tema: <link>"
- AND creates nothing

### Requirement: Deleted Topic Is Recreated

The system MUST detect a linked topic that no longer exists by posting the analysis into it (only a post that fails as `thread-gone`, a 400 saying the thread does not exist, means the topic is gone), drop the stale link, and create and link a new topic as for a fresh confirmation. A topic that still exists, or whose post fails for any other reason (closed topic, missing rights or another rejection, unavailable, rate-limited), MUST NOT be treated as deleted.

#### Scenario: Linked topic was deleted

- GIVEN `meridian` is linked to a topic deleted in Telegram
- WHEN an admin confirms participation
- THEN the stale link is dropped and a new topic is created, linked and pinned
- AND General shows the confirmation with the new link

#### Scenario: Topic check is inconclusive

- GIVEN `meridian` is linked to a topic and posting the analysis into it fails as rejected (closed topic, no rights), unavailable or rate-limited
- WHEN an admin confirms participation
- THEN no new topic is created and the link is kept
- AND General replies with the existing topic link

### Requirement: At Most One Topic per Analysis

The system MUST guarantee at most one topic per analysis under webhook redelivery and concurrent confirmations. Once a topic exists it MUST be linked immediately, and no later failure MUST cause the update to be retried into a second topic.

#### Scenario: Webhook redelivery

- GIVEN a confirmation already created and linked a topic
- WHEN Telegram redelivers the same update
- THEN no second topic is created

#### Scenario: Concurrent taps

- GIVEN two admins tap the button for the same analysis at the same time
- WHEN both updates are processed
- THEN exactly one topic exists for the analysis
- AND the other tap receives "Este hackathon ya tiene tema: <link>" or a neutral no-op

### Requirement: Confirmation, Pin and Button Removal

After creating a topic the system MUST post "✅ Participamos en <name> → <link>" in General, remove the button from the analysis message, and post and pin the analysis in the new topic. `<name>` is the sanitized hackathon name. Removing the button MUST be best-effort.

#### Scenario: Successful confirmation

- GIVEN an admin taps the button
- WHEN the topic is created
- THEN General receives "✅ Participamos en Meridian Hack 2026 → <link>"
- AND the button is removed from the analysis message
- AND the analysis is posted and pinned in the topic

#### Scenario: Pin failure

- GIVEN the bot lacks "Pin Messages"
- WHEN participation is confirmed
- THEN the analysis is posted unpinned and the link persists
- AND the reply states "No se pudo fijar el mensaje; se publicó sin fijar."

### Requirement: Missing Rights or Non-Forum Chat

The system MUST reply with an operator-facing message and MUST persist nothing when the bot cannot create topics or the chat is not a forum.

#### Scenario: Bot lacks Manage Topics

- GIVEN the bot does not have `can_manage_topics`
- WHEN an admin confirms participation
- THEN the system replies "No puedo crear temas: concede al bot el permiso «Administrar temas» y vuelve a intentarlo."
- AND no link is stored

#### Scenario: Chat is not a forum

- GIVEN the group has topics disabled
- WHEN an admin confirms participation
- THEN the system replies "Este grupo no tiene los temas activados. Actívalos en la configuración del grupo y vuelve a intentarlo."
- AND no link is stored

#### Scenario: Telegram rejects topic creation

- GIVEN Telegram refuses to create the topic (rate limit or another rejection)
- WHEN an admin confirms participation
- THEN the system replies "Telegram rechazó la creación del tema. Inténtalo de nuevo en un minuto."
- AND no link is stored and the creation claim is released

#### Scenario: Topic creation outcome is uncertain

- GIVEN Telegram times out or fails with a server error while creating the topic, so the topic may exist
- WHEN an admin confirms participation
- THEN the system replies "No se pudo confirmar si se creó el tema. Revisa la lista de temas antes de volver a intentarlo."
- AND no link is stored
- AND the creation claim is kept until it expires, so an immediate retry cannot create a duplicate topic

### Requirement: Partial Failure After Topic Creation

The system MUST keep the created topic and its link when a later step fails, MUST NOT fail the update, and MUST reply with a recovery hint.

#### Scenario: Posting the analysis in the topic fails

- GIVEN the topic was created and linked
- WHEN posting the analysis in it fails
- THEN the link persists
- AND the system replies "Se creó el tema y se vinculó <slug>, pero no se pudo publicar el análisis. Ejecuta /hackathon <slug> dentro del tema: <link>"

#### Scenario: Linking the topic fails

- GIVEN the topic was created
- WHEN storing the link to it fails
- THEN the topic remains and the update does not fail
- AND the system replies "Se creó el tema, pero no se pudo vincular <slug>. Ejecuta /hackathon <slug> dentro del tema: <link>"

#### Scenario: Confirmation or button removal fails

- GIVEN the topic was created, linked and pinned
- WHEN the General confirmation or the button removal fails
- THEN the topic and link remain and no second topic is created
