/**
 * The slug for the local-development-only Coralina draft preview.
 *
 * Deliberately split out of `demo-preview.ts`: this file has zero logic and no
 * dependency on the preview adapter, so callers that only need to recognize the
 * slug (e.g. the booth "unpublished draft" badge) never pull the heavier
 * preview implementation into their bundle graph.
 */
export const DEMO_PREVIEW_SLUG = "coralina";
