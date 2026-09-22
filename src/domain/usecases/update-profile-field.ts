import { canEditProfile } from "../access-policy";
import type { ProfileFieldName } from "../entities";
import { NotFoundError, UnauthorizedError } from "../errors";
import type { MembershipId, TeamId } from "../ids";
import type { Clock, MembershipRepo, ProfileRepo } from "../ports";

export interface UpdateProfileFieldInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  targetMembershipId: MembershipId;
  field: ProfileFieldName;
  value: string;
  keyVersion: number | null;
}

export interface UpdateProfileFieldDeps {
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  clock: Clock;
}

export async function updateProfileField(
  input: UpdateProfileFieldInput,
  deps: UpdateProfileFieldDeps,
): Promise<void> {
  const actor = await deps.membershipRepo.get(input.teamId, input.actorMembershipId);
  const target = await deps.membershipRepo.get(input.teamId, input.targetMembershipId);
  if (!actor || !target) {
    throw new NotFoundError("Actor or target membership not found");
  }
  if (!canEditProfile(actor, target)) {
    throw new UnauthorizedError(
      "Only the profile owner or a team admin may edit this field",
    );
  }

  const existing = (await deps.profileRepo.list(input.teamId, target.id)).find(
    (f) => f.field === input.field,
  );

  // FIX-001: an `unreadable` existing field (RES-001) has value "" as a
  // placeholder, never real plaintext — it MUST NOT be fabricated into the
  // audit trail as oldValue. Flag it explicitly so the adapter preserves
  // the original stored ciphertext instead of losing it.
  await deps.profileRepo.upsertField(
    input.teamId,
    {
      teamId: input.teamId,
      membershipId: target.id,
      field: input.field,
      value: input.value,
      keyVersion: input.keyVersion,
      updatedAt: deps.clock.now(),
    },
    actor.id,
    {
      field: input.field,
      oldValue: existing?.unreadable ? null : existing?.value ?? null,
      newValue: input.value,
      keyVersion: input.keyVersion,
      ...(existing?.unreadable ? { oldValueUnreadable: true } : {}),
    },
  );
}
