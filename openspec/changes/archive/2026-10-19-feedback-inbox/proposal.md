## Why

During live demos, hackathons, and mobile testing, developers and team members encounter bugs and receive user feedback away from their development machines. Opening formal GitHub issues immediately is high-friction, leads to duplicate or poorly structured issues, and violates repository contribution standards. Furthermore, typing long bug descriptions on mobile during a demo is cumbersome compared to sending a quick voice message.

This change introduces an in-chat feedback and bug inbox for Hack-bot, allowing team members to record raw observations and feedback via text or voice messages (transcribed with Whisper on Cloudflare Workers AI), store them per team and target repository, and synthesize all unprocessed inbox notes into consolidated briefings on demand.

## What Changes

- Add voice note transcription support to the natural language pipeline using Cloudflare Workers AI (`@cf/openai/whisper-large-v3-turbo`) so voice messages in Telegram are transcribed and routed seamlessly through the natural language intents.
- Add a new `feedback-inbox` domain capability and D1 storage table (`feedback_notes`) to store raw bug reports, feedback, and demo observations.
- Associate notes with the originating team, author (membership), target repository hint (if mentioned or inferred from topic), status (`inbox`, `triaged`, `archived`), and timestamp.
- Implement an adaptive, state-driven synthesis strategy: rather than relying on arbitrary daily or weekly calendar buckets, the synthesis operates on all pending notes (`status = 'inbox'`) regardless of elapsed time, indicating the actual date span covered, while optionally respecting natural language temporal requests (e.g., "resumen de hoy").
- Extend natural language classification (`natural-language-text`) with new intents:
  - `capture_feedback`: parse raw report text, optional repo hint, and tags.
  - `list_feedback`: list recent unprocessed feedback notes for a team/repo.
  - `summarize_feedback`: invoke LLM extraction to synthesize unprocessed notes into a structured briefing ready for GitHub issue creation.
  - `archive_feedback`: mark notes or a summarized batch as triaged/archived.
- Add copy strings for feedback intake confirmation, listings, and summary presentation in `bot-copy`.

## Capabilities

### New Capabilities

- `feedback-inbox`: Captures, queries, and manages raw feedback and bug observations in team-scoped storage, providing state-driven retrieval and AI-assisted synthesis of grouped observations without directly mutating GitHub.

### Modified Capabilities

- `natural-language-text`: Adds voice message transcription (`message:voice`) using Whisper STT and adds intent recognition and slot extraction for `capture_feedback`, `list_feedback`, `summarize_feedback`, and `archive_feedback` intents.
- `bot-copy`: Adds bot response copy for feedback intake acknowledgment, note listings, date-ranged summaries, and triaged status confirmations.

## Impact

- **Database**: New migration adding `feedback_notes` table with indexes on `(team_id, status)` and `(team_id, repo_hint)`.
- **Domain**: New ports and use cases for audio transcription, feedback recording, listing, status updates, and summary generation.
- **Adapters**: Telegram voice file download adapter, Cloudflare Workers AI Whisper STT adapter, D1 repository adapter for feedback notes, grammar/intent classifier updates for Workers AI.
- **Dependencies**: No new external dependencies; reuses existing Cloudflare Workers AI (`@cf/openai/whisper-large-v3-turbo` and `@cf/meta/llama-3.1-8b-instruct`) and D1 infrastructure.
