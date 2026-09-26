# Archive Report: GitHub Alerts

**Date**: 2026-09-26
**Change**: github-alerts
**Artifact Store**: hybrid (OpenSpec + Engram)
**Status**: ARCHIVED

## Change Summary

GitHub org webhook alerts delivered to linked Telegram forum topics. It adds an HMAC-verified `POST /github/webhook` route, org claims and repo-topic links in D1, issue and pull request alert routing, and the admin commands `/linkrepo`, `/unlinkrepo` and `/repos`. It shipped in five chained PRs (#12 to #16) after the planning PR #11.

## Artifacts Persisted

### OpenSpec Filesystem (authoritative)
- `openspec/specs/github-alerts/spec.md`: new capability, taken from the delta spec
- `openspec/specs/github-webhook/spec.md`: new capability, taken from the delta spec
- `openspec/specs/repo-topic-links/spec.md`: new capability, taken from the delta spec
- `openspec/changes/archive/2026-09-26-github-alerts/`: the complete change archive, with every artifact kept

### Engram Memory (mirror, traceability)
- `sdd/github-alerts/verify-report`
- `sdd/github-alerts/archive-report`

## Verification

- Verdict: PASS (see `verify-report.md`, including the post-verify resolution)
- Tests: 334/334 passing; typecheck clean
- Tasks: 27/27 checked, including operator rollout tasks 6.1 to 6.3
- Rollout: org webhook `686170412` is active; the signed ping returned 200
