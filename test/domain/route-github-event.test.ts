import { describe, expect, it } from "vitest";
import { routeGithubEvent } from "../../src/domain/usecases/route-github-event";
import { NotFoundError } from "../../src/domain/errors";
import type { GithubEvent } from "../../src/domain/github";
import { parseRepoFullName } from "../../src/domain/github";
import { asTeamId } from "../../src/domain/ids";
import {
  fakeAlertSender,
  fakeGithubOrgClaimRepo,
  fakeRepoTopicLinkRepo,
  fakeTeamRepo,
} from "../fakes";

const teamId = asTeamId("team-1");
const repo = parseRepoFullName("octocat/hello-world")!;

function makeEvent(overrides: Partial<GithubEvent> = {}): GithubEvent {
  return {
    org: "octocat",
    repo,
    kind: "pull_request",
    action: "opened",
    number: 42,
    title: "Fix the thing",
    url: "https://github.com/octocat/hello-world/pull/42",
    actor: "octocat",
    ...overrides,
  };
}

function makeDeps() {
  return {
    githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    teamRepo: fakeTeamRepo(),
    alertSender: fakeAlertSender(),
  };
}

describe("routeGithubEvent", () => {
  it("ignores an event whose org is not claimed by any team", async () => {
    const deps = makeDeps();

    const result = await routeGithubEvent(makeEvent(), deps);

    expect(result).toEqual({ kind: "ignored", reason: "unclaimed-org" });
    expect(deps.alertSender.sent).toHaveLength(0);
  });

  it("ignores an event for a repo with no link, even when the org is claimed", async () => {
    const deps = makeDeps();
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });

    const result = await routeGithubEvent(makeEvent(), deps);

    expect(result).toEqual({ kind: "ignored", reason: "unlinked-repo" });
    expect(deps.alertSender.sent).toHaveLength(0);
  });

  it("delivers an alert to the linked topic for a linked, claimed repo", async () => {
    const deps = makeDeps();
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repo,
      orgLogin: "octocat",
      threadId: 55,
      createdAt: 0,
      updatedAt: 0,
    });
    deps.teamRepo.rows.push({ id: teamId, chatId: 999, dataTopicThreadId: null, createdAt: 0 });

    const result = await routeGithubEvent(makeEvent(), deps);

    expect(result).toEqual({ kind: "delivered", teamId });
    expect(deps.alertSender.sent).toHaveLength(1);
    expect(deps.alertSender.sent[0]).toMatchObject({ chatId: 999, threadId: 55 });
  });

  it("returns send-failed (not thrown) when the alert sender fails, without retrying", async () => {
    const deps = makeDeps();
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repo,
      orgLogin: "octocat",
      threadId: 55,
      createdAt: 0,
      updatedAt: 0,
    });
    deps.teamRepo.rows.push({ id: teamId, chatId: 999, dataTopicThreadId: null, createdAt: 0 });
    const failingDeps = {
      ...deps,
      alertSender: fakeAlertSender({ throws: true, failureClass: "rate-limited" }),
    };

    const result = await routeGithubEvent(makeEvent(), failingDeps);

    // PR4 correction (RES-001): the AlertSendFailedError's failureClass is
    // carried through the result so the HTTP adapter can log a
    // distinguishable, non-sensitive reason.
    expect(result).toEqual({ kind: "send-failed", teamId, failureClass: "rate-limited" });
  });

  it("propagates (rejects) an unexpected error from the org claim lookup, instead of an ignored outcome (RES-001)", async () => {
    const deps = makeDeps();
    const failingDeps = { ...deps, githubOrgClaimRepo: fakeGithubOrgClaimRepo({ throws: true }) };

    await expect(routeGithubEvent(makeEvent(), failingDeps)).rejects.toThrow("D1 unavailable");
    expect(deps.alertSender.sent).toHaveLength(0);
  });

  it("propagates (rejects) an unexpected error from the repo link lookup, instead of an ignored outcome (RES-001)", async () => {
    const deps = makeDeps();
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });
    const failingDeps = { ...deps, repoTopicLinkRepo: fakeRepoTopicLinkRepo({ throws: true }) };

    await expect(routeGithubEvent(makeEvent(), failingDeps)).rejects.toThrow("D1 unavailable");
    expect(deps.alertSender.sent).toHaveLength(0);
  });

  it("rejects with NotFoundError when the claim and link exist but the team row is missing (REL-002/RES-002)", async () => {
    const deps = makeDeps();
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repo,
      orgLogin: "octocat",
      threadId: 55,
      createdAt: 0,
      updatedAt: 0,
    });
    // No row pushed to deps.teamRepo — the team is missing despite the
    // claim and link existing (a data-integrity problem, not a normal
    // "no alert" outcome).

    await expect(routeGithubEvent(makeEvent(), deps)).rejects.toThrow(NotFoundError);
    expect(deps.alertSender.sent).toHaveLength(0);
  });
});

// REL-001 (PR2 review correction): fakeGithubOrgClaimRepo must normalize
// case exactly like the D1 adapter (createD1GithubOrgClaimRepo lowercases
// both findTeamByOrg and isClaimedBy lookups), so a domain test using the
// fake cannot pass on a case assumption the real adapter would reject.
describe("fakeGithubOrgClaimRepo (contract parity with the D1 adapter)", () => {
  it("isClaimedBy matches regardless of the input's case", () => {
    const claimRepo = fakeGithubOrgClaimRepo();
    claimRepo.rows.push({ teamId, orgLogin: "case-org" });

    return expect(claimRepo.isClaimedBy(teamId, "Case-Org")).resolves.toBe(true);
  });

  it("findTeamByOrg matches regardless of the input's case", () => {
    const claimRepo = fakeGithubOrgClaimRepo();
    claimRepo.rows.push({ teamId, orgLogin: "case-org-2" });

    return expect(claimRepo.findTeamByOrg("Case-Org-2")).resolves.toBe(teamId);
  });
});
