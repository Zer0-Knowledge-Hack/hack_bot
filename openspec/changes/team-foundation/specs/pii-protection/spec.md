# PII Protection Specification

## Purpose

Protects personally identifiable profile data at rest and in logs, independent of any single team's configuration.

## Requirements

### Requirement: Sensitive PII Fields Encrypted at Rest

The system MUST encrypt full name, emails, and social links using AES-GCM (WebCrypto) before persisting them to D1, and MUST decrypt them only for authorized reads.

#### Scenario: Field stored encrypted

- GIVEN a member sets their full name
- WHEN the value is persisted
- THEN the raw D1 row MUST NOT contain the plaintext full name
- AND the stored value MUST be AES-GCM ciphertext

#### Scenario: Authorized read decrypts value

- GIVEN a profile field is encrypted at rest
- WHEN any registered member of the same team (in the data channel or DM) requests it
- THEN the system decrypts it and returns the plaintext

### Requirement: GitHub Username Stored Plaintext

The system MUST store the GitHub username field in plaintext, as it is not treated as sensitive PII and is used for integrations in later changes.

#### Scenario: GitHub username readable in raw storage

- GIVEN a member sets their GitHub username
- WHEN the row is read directly from D1
- THEN the GitHub username field MUST be plaintext

### Requirement: Versioned Encryption Key

The system MUST tag every encrypted value with the key version used to encrypt it, and MUST support decrypting values written under any previously used key version.

#### Scenario: Value decrypts after key rotation groundwork

- GIVEN a profile field was encrypted under key version 1
- WHEN the system later supports key version 2 for new writes
- THEN reads of the version-1 value MUST still decrypt correctly using the stored version tag

### Requirement: PII Never Logged

The system MUST NOT write plaintext PII field values (full name, emails, social links) to logs, error messages, or traces. Only identifiers and field names MAY be logged.

#### Scenario: Error during profile update

- GIVEN a profile update fails after decryption or before encryption
- WHEN the system logs the error
- THEN the log entry MUST contain only IDs and field names, never the field value
