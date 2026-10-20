## ADDED Requirements

### Requirement: Feedback Inbox Copy Formatting

The system MUST format all feedback intake confirmations, voice transcription messages, feedback listings, and synthesized summaries in neutral, professional Spanish without raw JSON or unmapped technical error codes, and within the 4096-character Telegram limit.

#### Scenario: Feedback intake confirmation in Spanish
- **WHEN** a feedback note is stored
- **THEN** the confirmation message is sent in Spanish indicating that the observation was recorded in the inbox

#### Scenario: Feedback summary formatting with date span
- **WHEN** a feedback synthesis briefing is rendered for Telegram
- **THEN** the header specifies the total count and date span of the included notes (e.g. "Resumen de 5 observaciones entre el 12/10 y el 19/10")
- **AND** all section headers, labels, and bullet points are presented in clean Spanish text
- **AND** fits within the Telegram length limits

#### Scenario: Audio transcription failure copy
- **WHEN** a voice message cannot be transcribed due to noise or model failure
- **THEN** the bot responds with a friendly Spanish message indicating the audio could not be understood and requesting a repeat or text input
