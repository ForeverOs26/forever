/**
 * Forever Studio — server-enforced membership resolution.
 *
 * Authorization lives HERE, at the server/data boundary, never in the
 * browser. A valid Supabase session is necessary but not sufficient: the
 * caller must also hold an active studio_members row. There is no public
 * self-registration path — membership is created only by an Owner invite or
 * by the one-time, database-enforced single-winner Owner bootstrap below.
 */

import { StudioAccessError, type StudioActor, type StudioDeps } from "./contracts";

function normalizeEmail(value: string | null | undefined): string | null {
  const clean = value?.trim().toLowerCase();
  return clean ? clean : null;
}

/**
 * One-time Owner bootstrap. The caller qualifies only when it matches the
 * configured Owner identity — preferably a stable user id
 * (STUDIO_OWNER_USER_ID) or, failing that, an exact confirmed email
 * (STUDIO_OWNER_EMAIL). The actual insert is single-winner in the database
 * (advisory lock + partial unique index), so a race cannot mint two owners
 * and a non-empty roster never bootstraps.
 */
async function maybeBootstrapOwner(
  deps: StudioDeps,
  session: { userId: string; email: string | null; emailVerified: boolean },
): Promise<boolean> {
  const configuredUserId = deps.ownerBootstrapUserId();
  const configuredEmail = normalizeEmail(deps.ownerBootstrapEmail());

  const matchesUserId = configuredUserId != null && configuredUserId === session.userId;
  const matchesEmail =
    configuredEmail != null &&
    session.email != null &&
    normalizeEmail(session.email) === configuredEmail &&
    // An email match must be a confirmed identity; a user id match is already
    // a strong identity and does not depend on the email claim.
    session.emailVerified;

  if (!matchesUserId && !matchesEmail) return false;

  const created = await deps.data.bootstrapOwner(
    session.userId,
    session.email ?? configuredEmail ?? "",
  );
  if (!created) return false;

  await deps.data.recordAudit({
    actor_id: session.userId,
    actor_email: session.email,
    action: "studio_owner_bootstrap",
    table_name: "studio_members",
    record_id: session.userId,
    metadata: { via: matchesUserId ? "STUDIO_OWNER_USER_ID" : "STUDIO_OWNER_EMAIL" },
  });
  return true;
}

export async function resolveStudioActor(
  deps: StudioDeps,
  session: { userId: string; email: string | null; emailVerified?: boolean },
): Promise<StudioActor> {
  let membership = await deps.data.getMembership(session.userId);
  if (!membership) {
    const bootstrapped = await maybeBootstrapOwner(deps, {
      userId: session.userId,
      email: session.email,
      // Default to trusting the token's identity; callers pass the claim when
      // available. Bootstrap-by-email additionally requires this to be true.
      emailVerified: session.emailVerified ?? true,
    });
    if (bootstrapped) membership = await deps.data.getMembership(session.userId);
  }
  if (!membership) {
    throw new StudioAccessError(
      "studio_membership_required",
      "This account is not a Forever Studio member.",
    );
  }
  if (!membership.is_active) {
    throw new StudioAccessError(
      "studio_membership_disabled",
      "This Forever Studio membership has been disabled.",
    );
  }
  return {
    userId: membership.user_id,
    email: membership.email ?? session.email,
    role: membership.role,
    displayName: membership.display_name,
  };
}

export function assertOwner(actor: StudioActor): void {
  if (actor.role !== "owner") {
    throw new StudioAccessError("studio_owner_required", "Only the Owner may do this.");
  }
}

export function assertNotPartnerDemo(deps: StudioDeps): void {
  if (deps.partnerDemoActive()) {
    throw new StudioAccessError(
      "studio_disabled_in_partner_demo",
      "Forever Studio is disabled while Partner Demo mode is active.",
    );
  }
}
