/**
 * Forever Studio — server-enforced membership resolution.
 *
 * Authorization lives HERE, at the server/data boundary, never in the
 * browser. A valid Supabase session is necessary but not sufficient: the
 * caller must also hold an active studio_members row. There is no public
 * self-registration path — membership is created only by an Owner invite or
 * by the one-time Owner bootstrap below.
 */

import { StudioAccessError, type StudioActor, type StudioDeps } from "./contracts";

function normalizeEmail(value: string | null | undefined): string | null {
  const clean = value?.trim().toLowerCase();
  return clean ? clean : null;
}

/**
 * One-time Owner bootstrap: when the authenticated caller has no membership,
 * the roster is empty, and the caller's verified email equals
 * STUDIO_OWNER_EMAIL, an owner membership is created. This lets the Owner
 * start using Studio without SQL while keeping every other account locked
 * out (they fail the roster-empty check, the email check, or both).
 */
async function maybeBootstrapOwner(
  deps: StudioDeps,
  userId: string,
  email: string | null,
): Promise<boolean> {
  const configured = normalizeEmail(deps.ownerBootstrapEmail());
  if (!configured || !email || normalizeEmail(email) !== configured) return false;
  if ((await deps.data.countMembers()) > 0) return false;
  await deps.data.upsertMembership({
    user_id: userId,
    role: "owner",
    display_name: null,
    email,
    invited_by: null,
    is_active: true,
  });
  await deps.data.recordAudit({
    actor_id: userId,
    actor_email: email,
    action: "studio_owner_bootstrap",
    table_name: "studio_members",
    record_id: userId,
    metadata: { via: "STUDIO_OWNER_EMAIL" },
  });
  return true;
}

export async function resolveStudioActor(
  deps: StudioDeps,
  session: { userId: string; email: string | null },
): Promise<StudioActor> {
  let membership = await deps.data.getMembership(session.userId);
  if (!membership) {
    const bootstrapped = await maybeBootstrapOwner(deps, session.userId, session.email);
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
