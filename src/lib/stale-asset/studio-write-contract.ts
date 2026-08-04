/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the Studio write contract table.
 *
 * Closes independent-review P1-3. This is the checked-in enumeration of EVERY
 * Studio mutation, derived from actual source rather than from a report, and it
 * is machine-checked: `studio-write-contract.test.ts` parses
 * `studio.functions.ts` with the TypeScript compiler and fails when a
 * `createServerFn({ method: "POST" })` export exists that is not listed here,
 * when an entry here no longer exists, or when any call site of one of these
 * functions is not lexically inside `runStudioWriteAction`.
 *
 * A manually maintained list cannot detect a new call. This one can, which is
 * exactly what the review asked for.
 */

import type { StaleAssetConsequentialAction } from "./write-safety";

export type StudioWriteContractEntry = {
  /** The exported server function, or the named non-server-function write. */
  readonly mutation: string;
  /** Which consequential-action kind it registers as. */
  readonly action: StaleAssetConsequentialAction;
  /** Where registration happens — always synchronous, before dispatch. */
  readonly registration: string;
  /** Where the request actually leaves the browser. */
  readonly dispatch: string;
  /** Where the registration is released, and what reconciles an unknown result. */
  readonly release: string;
  /** What happens when the response is lost. */
  readonly lostResponse: string;
  /** What a page that has just been recovered does about it. */
  readonly recoveredPage: string;
};

/**
 * Server functions that are NOT writes. Listed explicitly so the contract test
 * can prove the split is deliberate rather than an omission.
 */
export const STUDIO_READ_ONLY_FUNCTIONS = [
  "studioGetOverview",
  "studioGetJobStatus",
  "studioGetJobProgress",
  "studioGetProjectDetail",
  "studioGetListingDetail",
  "studioGetProjectAmenities",
] as const;

export const STUDIO_WRITE_CONTRACT: readonly StudioWriteContractEntry[] = [
  {
    mutation: "studioStartJob",
    action: "upload_start",
    registration: "StudioUploader.submit — beginConsequentialAction before the whole upload lane",
    dispatch: "StudioUploader.submit",
    release: "the uploader's finally, after storage acceptance or a thrown failure",
    lostResponse:
      "the job may exist server-side; the dashboard's read-only overview reports it and nothing is re-created",
    recoveredPage: "nothing restarts; the job is durable and the overview shows its real state",
  },
  {
    mutation: "studioPlanArchiveUpload",
    action: "upload_start",
    registration: "runStudioWriteAction in archive-upload.requestPlan",
    dispatch: "archive-upload.requestPlan",
    release: "the same call's terminal path",
    lostResponse:
      "planning is idempotent for an identical manifest; a replan resumes the same archive id",
    recoveredPage: "no plan is re-requested automatically",
  },
  {
    mutation: "studioConfirmArchiveUpload",
    action: "upload_confirm",
    registration: "runStudioWriteAction in archive-upload confirm round",
    dispatch: "archive-upload confirm round",
    release: "the same call's terminal path",
    lostResponse: "the archive stays unconfirmed; the Owner resumes the upload by hand",
    recoveredPage: "nothing re-confirms automatically",
  },
  {
    mutation: "studioProcessJob",
    action: "job_processing",
    registration: "runStudioWriteAction in StudioUploader.pollProcessing",
    dispatch: "StudioUploader.pollProcessing",
    release: "each poll's terminal path",
    lostResponse:
      "processing continues server-side; the page says so and refuses to claim a result it does not have",
    recoveredPage: "no processing request is re-issued automatically",
  },
  {
    mutation: "studioResumePending",
    action: "resume_pending",
    registration: "runStudioWriteAction in StudioDashboard's durable-resume effect",
    dispatch: "StudioDashboard durable-resume effect",
    release: "the same call's terminal path",
    lostResponse: "server-side resume is idempotent and bounded by the retry policy",
    recoveredPage:
      "GATED — the effect refuses to fire while this page is recovering or has an unproven write, and only a read-only overview that resolved AFTER recovery re-enables it",
  },
  {
    mutation: "studioSetHeroImage",
    action: "project_hero",
    registration: "runStudioWriteAction in StudioProjectEditor.hero",
    dispatch: "StudioProjectEditor.hero mutationFn",
    release: "the same call's terminal path",
    lostResponse: "the hero may or may not be set; the editor's read-only refetch establishes it",
    recoveredPage: "nothing re-submits",
  },
  {
    mutation: "studioSetProjectPublication",
    action: "publication",
    registration: "runStudioWriteAction in StudioProjectEditor.publication and StudioDashboard",
    dispatch: "both mutationFns",
    release: "the same call's terminal path",
    lostResponse: "publication state is read back by the overview; nothing republishes",
    recoveredPage: "no publication automatically restarts",
  },
  {
    mutation: "studioSaveProjectFacts",
    action: "project_facts",
    registration: "runStudioWriteAction in StudioProjectEditor.save",
    dispatch: "StudioProjectEditor.save mutationFn",
    release: "the same call's terminal path",
    lostResponse: "the precedence-aware save is last-writer-wins per field; the refetch shows truth",
    recoveredPage: "nothing re-saves; unsaved form state is simply gone, as it is on any reload",
  },
  {
    mutation: "studioSaveProjectAmenities",
    action: "project_amenities",
    registration: "runStudioWriteAction in StudioProjectAmenitiesEditor.save",
    dispatch: "StudioProjectAmenitiesEditor.save mutationFn",
    release: "the same call's terminal path",
    lostResponse: "the committed set is read back on the next query",
    recoveredPage: "nothing re-saves",
  },
  {
    mutation: "studioSetListingPublication",
    action: "publication",
    registration: "runStudioWriteAction in StudioResaleEditor.publication and StudioDashboard",
    dispatch: "both mutationFns",
    release: "the same call's terminal path",
    lostResponse: "publication state is read back by the overview; nothing republishes",
    recoveredPage: "no publication automatically restarts",
  },
  {
    mutation: "studioUpdateResale",
    action: "resale_facts",
    registration: "runStudioWriteAction in StudioResaleEditor.save",
    dispatch: "StudioResaleEditor.save mutationFn",
    release: "the same call's terminal path",
    lostResponse: "the committed facts are read back on the next query",
    recoveredPage: "nothing re-saves",
  },
  {
    mutation: "studioInviteMember",
    action: "member_change",
    registration: "runStudioWriteAction in StudioMembers.invite",
    dispatch: "StudioMembers.invite mutationFn",
    release: "the same call's terminal path",
    lostResponse: "membership is read back by the overview; no second invitation is sent",
    recoveredPage: "nothing re-invites",
  },
  {
    mutation: "studioSetMemberActive",
    action: "member_change",
    registration: "runStudioWriteAction in StudioMembers.setActive",
    dispatch: "StudioMembers.setActive mutationFn",
    release: "the same call's terminal path",
    lostResponse: "membership is read back by the overview",
    recoveredPage: "nothing re-applies",
  },
];

/**
 * Writes that are NOT Studio server functions, and therefore cannot be found by
 * scanning `studio.functions.ts`. Listed so the inventory is complete.
 */
export const STUDIO_NON_SERVER_FUNCTION_WRITES: readonly StudioWriteContractEntry[] = [
  {
    mutation: "supabase auth.updateUser (password)",
    action: "password_update",
    registration: "StudioResetPassword — beginConsequentialAction before the request leaves",
    dispatch: "the local recovery client only, never the shared client",
    release: "the surrounding finally",
    lostResponse:
      "the password may have changed; the visitor signs in to find out and nothing replays",
    recoveredPage:
      "unreachable — /studio/reset-password is on the automatic-recovery deny list, so no automatic reload ever happens there",
  },
  {
    mutation: "Owner Retry submit (studioProcessJob via the dashboard lane)",
    action: "owner_retry_submit",
    registration: "StudioDashboard.startOwnerRetry — synchronously, with the absolute deadline",
    dispatch: "retryJob.mutateAsync",
    release:
      "released on submit settle; a lost response instead marks the action unreconciled, and only the read-only Refresh path clears it",
    lostResponse:
      "the truthful `timeout` state, which explicitly refuses to resubmit; only the read-only Refresh may establish truth",
    recoveredPage: "no Retry automatically restarts; exactly-once semantics are unchanged",
  },
  {
    mutation: "Owner Retry observation",
    action: "owner_retry_observe",
    registration: "StudioDashboard.observeOwnerRetry, once the submit has settled",
    dispatch:
      "no write of its own — it holds the action open while the read-only status poll watches the job",
    release: "clearOwnerRetryTimers, which every terminal path funnels through",
    lostResponse:
      "not applicable — observation reads; the one absolute deadline bounds how long it may hold",
    recoveredPage: "no observation resumes automatically; the Owner reopens the job history",
  },
];

/**
 * Call sites that are registered by an EQUIVALENT mechanism rather than by the
 * boundary wrapper, each with the reason and the registration that must exist.
 *
 * This list is the only escape from the AST check, it is exhaustive, and the
 * contract test verifies each stated registration is really present. A NEW call
 * site that is neither wrapped nor listed here fails the suite — which is the
 * property the review asked for.
 */
export const STUDIO_WRITE_BOUNDARY_EXEMPTIONS: ReadonlyArray<{
  readonly file: string;
  readonly mutation: string;
  readonly why: string;
  readonly registrationMustContain: string;
}> = [
  {
    file: "src/features/forever-studio/components/StudioDashboard.tsx",
    mutation: "studioProcessJob",
    why: "the Owner Retry lane holds ONE registration across two phases — submit, then observation — which no single promise spans, and it owns the absolute deadline that makes Retry exactly-once. Wrapping it would release the action when the submit settled and leave the observation unguarded.",
    registrationMustContain: 'beginConsequentialAction("owner_retry_submit")',
  },
];
