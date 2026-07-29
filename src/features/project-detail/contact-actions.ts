/**
 * Whether the contextual project and unit contact actions may be presented
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, finding F5).
 *
 * ## Why this gate exists
 *
 * The contact-flow PRD opens with gate G0:
 *
 * > **The submission path must be proven to deliver end-to-end**, with a test
 * > lead created in a non-production context, before a single new CTA is
 * > exposed to the public. The existing contact form's delivery has never been
 * > verified. Shipping more entry points into an unverified pipe is the largest
 * > risk in this whole design.
 *
 * G0 is open in both research sets. PR #116 nevertheless ships "Request
 * details" and "Request a viewing" beside every project, and both again in a
 * sticky mobile bar — four new entry points into a pipe nobody has watched
 * deliver a single lead.
 *
 * ## What the gate does
 *
 * It fails closed. The actions are **absent** unless configuration says, in one
 * exact word, that they have been verified. There is no disabled button: the
 * PRD requires an unavailable capability to render nothing and the layout to
 * reflow around the absence, because a greyed-out control still advertises a
 * capability and still invites a click that goes nowhere.
 *
 * Absent also means: no calendar, no "your viewing is booked" confirmation, no
 * Guide selection and no personal staff account. None of those exist in this
 * codebase and none may be added behind this flag — the flag governs whether
 * the two existing contact-route links may be shown, nothing more.
 *
 * ## What it does not govern
 *
 * The site-wide `/contact` route is untouched. It is already public, it is not
 * a contextual project or unit action, and removing it would remove Forever's
 * only advisory entry point. G0 concerns *new* CTAs; this gate withholds the
 * ones PR #116 adds beside project content.
 *
 * ## The exact condition required to enable it
 *
 * Set `VITE_PROJECT_CONTACT_ACTIONS=enabled` at build time **only once all of
 * the following are true and recorded:**
 *
 *   1. A test lead has been submitted through the production contact form in a
 *      non-production context and has been observed to arrive at its
 *      destination — the stored row and the human-visible notification.
 *   2. The observation is written down with a timestamp, the request id and who
 *      confirmed it, so the evidence outlives the session that produced it.
 *   3. A failed submission has been shown to surface an honest error to the
 *      guest rather than a silent success.
 *   4. The quarantine path of PRD §16.3 ("No silent loss") is in place, so a
 *      lead rejected by a heuristic is reviewable rather than discarded.
 *
 * Any other value, a missing value, a malformed value, or the string "true" all
 * leave the actions absent. Only the exact token `enabled` turns them on, so a
 * half-configured environment cannot half-open the gate.
 */

/** The one value that opens the gate. */
export const PROJECT_CONTACT_ACTIONS_ENABLED_TOKEN = "enabled";

/** The build-time variable that carries it. */
export const PROJECT_CONTACT_ACTIONS_ENV_KEY = "VITE_PROJECT_CONTACT_ACTIONS";

/**
 * Whether contextual project/unit contact actions may render.
 *
 * The parameter exists so tests can exercise the gate without mutating the
 * ambient environment; production callers pass nothing.
 */
export function projectContactActionsEnabled(
  configuredValue: unknown = import.meta.env.VITE_PROJECT_CONTACT_ACTIONS,
): boolean {
  return configuredValue === PROJECT_CONTACT_ACTIONS_ENABLED_TOKEN;
}
