## 1. Storage and Schema

- [x] 1.1 Add D1 migration creating `feedback_notes` table (with `source_type`) and indexes
- [x] 1.2 Define `FeedbackNote`, `FeedbackStatus`, and `FeedbackSource` in `src/domain/entities.ts`
- [x] 1.3 Add `FeedbackRepo` port contract to `src/domain/ports.ts`
- [x] 1.4 Implement D1 repository adapter in `src/adapters/d1/feedback-repo.ts` with unit tests

## 2. Voice and Audio Transcription

- [x] 2.1 Add `SpeechToText` port contract to `src/domain/ports.ts`
- [x] 2.2 Implement Workers AI Whisper adapter in `src/adapters/llm/workers-ai-whisper.ts` with unit tests
- [x] 2.3 Implement Telegram voice downloader helper using Bot API `getFile` in `src/adapters/telegram/voice.ts`
- [x] 2.4 Wire `message:voice` events in Telegram adapter to download, transcribe, and route into `handleNaturalLanguage`

## 3. Domain Use Cases

- [x] 3.1 Implement `recordFeedback` use case with repository hint resolution and unit tests
- [x] 3.2 Implement `listFeedback` use case with status and repo filters and unit tests
- [x] 3.3 Implement `synthesizeFeedback` adaptive use case (unprocessed inbox + date range detection) with unit tests
- [x] 3.4 Implement `archiveFeedback` use case to transition notes from `inbox` to `triaged` with unit tests

## 4. Natural Language and Intent Integration

- [x] 4.1 Add `capture_feedback`, `list_feedback`, `summarize_feedback`, and `archive_feedback` to `NL_INTENT_IDS` in `src/domain/nl/intents.ts`
- [x] 4.2 Update Workers AI intent prompt and slot parser in `src/adapters/llm/workers-ai-intent-classifier.ts`
- [x] 4.3 Wire new intents in `handle-natural-language.ts` to dispatch to feedback use cases

## 5. Bot Copy, Wiring and Verification

- [x] 5.1 Add Spanish copy strings for intake confirmation, empty inbox, date-ranged summaries, and transcription errors in `src/domain/copy.ts`
- [x] 5.2 Wire all new repositories, adapters, and use cases into `src/composition.ts`
- [x] 5.3 Add integration tests for text and voice feedback flows in `test/adapters/telegram/natural-language.test.ts`
- [x] 5.4 Run full test suite (`npm test`) and verify clean typecheck (`npm run typecheck`)
