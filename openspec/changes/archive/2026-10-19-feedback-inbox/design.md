## Context

See `proposal.md` for motivation. The bot runs on Cloudflare Workers with Hono, grammY, D1 storage, and Workers AI. All tenant-scoped operations mandate `TeamId` as the first argument in domain ports. The Natural Language pipeline (`handle-natural-language.ts`) classifies user utterances into a closed set of intents using `@cf/meta/llama-3.1-8b-instruct`. Cloudflare Workers AI natively supports `@cf/openai/whisper-large-v3-turbo` for speech-to-text.

## Goals / Non-Goals

**Goals:**
- Provide team-scoped storage for raw bug reports, feedback, and demo observations in Cloudflare D1.
- Support both text messages and Telegram voice notes (`message:voice`), transcribing audio with Whisper before passing it to the intent classifier.
- Implement an adaptive, state-driven synthesis strategy: summarize whatever is pending in `status = 'inbox'`, reporting the real-world date range spanned, with optional natural language date narrowing.
- Provide AI-assisted synthesis of collected notes into a consolidated issue-ready briefing using Workers AI.
- Enable marking notes as `triaged` or `archived` so the inbox resets for future sessions.

**Non-Goals:**
- Direct GitHub issue creation or mutation (remains the responsibility of local development workflows and CLI tools).
- Bot audio voice replies (text replies only).
- Public/unauthenticated feedback endpoints.

## Decisions

### Decision 1: Voice Note Pipeline via Whisper STT

When grammY receives an eligible `message:voice`, the flow is:
1. `TelegramVoiceFetcher` uses `ctx.api.getFile(voice.file_id)` to resolve the download URL and fetches the raw audio buffer (OGG/Opus).
2. `SpeechToText` port calls Cloudflare Workers AI:
   ```typescript
   const response = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
     audio: [...new Uint8Array(audioBuffer)],
   });
   ```
3. The resulting transcript text is passed directly into `handleNaturalLanguage({ classifiedText: transcript.text, ... })`.

*Alternatives considered*:
- Using an external transcription API (e.g. OpenAI Whisper API): Rejected to avoid external API keys and latency; Cloudflare Workers AI runs within the worker's execution environment.

### Decision 2: D1 Table Schema for Feedback Notes

The new table `feedback_notes` follows multi-tenant architecture with strict `team_id` partitioning:

```sql
CREATE TABLE feedback_notes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  author_membership_id TEXT NOT NULL REFERENCES memberships(id),
  repo_hint TEXT,
  raw_text TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'voice'
  status TEXT NOT NULL DEFAULT 'inbox',     -- 'inbox' | 'triaged' | 'archived'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_feedback_notes_team_status ON feedback_notes(team_id, status);
CREATE INDEX idx_feedback_notes_team_repo ON feedback_notes(team_id, repo_hint);
```

### Decision 3: Adaptive State-Driven Synthesis Strategy

Instead of rigid calendar jobs (e.g., daily cron summaries), the synthesis operates on **unprocessed inbox state**:
- **Query**: Select notes matching `team_id`, `status = 'inbox'`, and matching `repo_hint` (if specified), ordered by `created_at ASC` up to 30 notes.
- **Date Span Metadata**: The use case extracts `min(created_at)` and `max(created_at)` from the matched set and formats the header (e.g., *"Resumen de 7 observaciones (12/10 al 19/10)"*).
- **Temporal Narrowing (Optional)**: If the user says *"resumen de hoy"* or *"resumen de esta semana"*, a `sinceTimestamp` filter is applied over the pending notes.
- **Triage Transition**: After a summary is reviewed, a member can mark the batch as processed (`archive_feedback`), moving their status to `triaged`.

### Decision 4: Hexagonal Domain Ports & Use Cases

Isolate storage and AI dependencies behind domain ports:
- `FeedbackRepo`:
  - `save(teamId: TeamId, note: FeedbackNote): Promise<void>`
  - `list(teamId: TeamId, filter: FeedbackFilter): Promise<FeedbackNote[]>`
  - `updateStatus(teamId: TeamId, noteIds: string[], status: FeedbackStatus): Promise<void>`
- `SpeechToText`:
  - `transcribe(audioBuffer: ArrayBuffer, signal: AbortSignal): Promise<string>`
- `FeedbackSynthesizer`:
  - `synthesize(notes: FeedbackNote[], signal: AbortSignal): Promise<FeedbackSummary>`
- Domain use cases:
  - `record-feedback.ts`: Validates caller membership, derives repo hint from topic context if omitted, and saves note.
  - `list-feedback.ts`: Retrieves active notes for the team/repo.
  - `synthesize-feedback.ts`: Loads active notes and formats them via `FeedbackSynthesizer`.
  - `archive-feedback.ts`: Marks processed notes as `triaged`.

## Risks / Trade-offs

- **[Risk] Ambient noise in voice notes during live demos** → *Mitigation*: Whisper STT handles background chatter robustly; if confidence/length is below threshold, the bot returns a friendly error asking to re-record or type.
- **[Risk] Irregular activity creating huge note batches** → *Mitigation*: Synthesis is capped at 30 notes per batch, ensuring responses comfortably fit within the Workers AI context window and Telegram's 4096-character limit.
