/**
 * The delivered scope of the amenities editor, and its one deferred dependency
 * (FOREVER-PR119-AMENITIES-FINAL-CORRECTION-001).
 *
 * WHAT IS IMPLEMENTED
 * -------------------
 * The Facilities & Amenities editor exists for an EXISTING Developer Project, at
 * `/studio/project/$slug`. An Owner selects, notes, features, orders and saves a
 * project's amenities, and the save is one all-or-nothing transaction.
 *
 * WHAT IS NOT IMPLEMENTED
 * -----------------------
 * Amenities selected while CREATING a new Developer Project are not saved with
 * that project. The `/studio/upload` flow has no amenities step, and the original
 * requirement that "selected amenities save with the project" is therefore met for
 * the update flow only.
 *
 * WHY IT WAS NOT DONE HERE
 * ------------------------
 * Not effort — structure. In the create flow there is no project row and no
 * project id until the ingest job completes, so there is nothing for
 * `project_amenities.project_id` to reference at the moment the Owner is choosing
 * amenities. Making it atomic would mean carrying the selection through
 * `StudioProjectFacts` (a flat record of scalars, whose zod schema is `.strip()`ed
 * to exactly its known keys), the batch builder, and the ingest transaction
 * itself. That is a change to the Fast Publish create pipeline, which this task
 * was explicitly scoped out of, and doing it badly would mean a project that
 * publishes with a half-written amenity set.
 *
 * THE DEPENDENCY
 * --------------
 * FOREVER-STUDIO-FAST-PUBLISH-AMENITIES-INTEGRATION-001 adds amenities to the
 * new-project Fast Publish flow, after the semantic-media, PR #118 and Amenities
 * Core stack is merged.
 *
 * WHY THIS IS A TEST RATHER THAN A COMMENT
 * ----------------------------------------
 * A deferred requirement recorded only in a report is a deferred requirement
 * nobody finds again. These assertions fail the moment someone wires amenities
 * into the create flow without also retiring this file — which is exactly when
 * the deferral stops being true and every claim built on it needs revisiting.
 *
 * There is deliberately NO assertion that this file mentions the follow-up ID.
 * An earlier revision had one: it read its own source and asserted the presence
 * of a literal written inside the assertion, so it could not fail while the file
 * existed. The ID is recorded above, where `grep` finds it; a tautology dressed
 * as a test only makes the suite look larger than it is.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const STUDIO = resolve(root, "src/features/forever-studio");

const read = (relative: string) => readFileSync(resolve(STUDIO, relative), "utf8");

describe("the amenities editor is scoped to an existing project", () => {
  it("is mounted in the project editor, and only there", () => {
    // The update-flow editor renders the section...
    const projectEditor = read("components/StudioProjectEditor.tsx");
    expect(projectEditor).toContain("StudioProjectAmenitiesEditor");

    // ...and nothing in the create flow does — neither the uploader component nor
    // the route that mounts it, because a step added at the route level would
    // escape a scan of the component alone.
    for (const file of [
      resolve(STUDIO, "components/StudioUploader.tsx"),
      resolve(root, "src/routes/studio.upload.tsx"),
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("StudioProjectAmenitiesEditor");
      expect(source, file).not.toMatch(/\bamenit/i);
    }
  });

  it("keys its endpoints on a project slug, which a new project does not yet have", () => {
    // Both endpoints require an existing project's slug. That is the mechanical
    // reason the create flow cannot reuse them as they stand: at the moment the
    // Owner is choosing amenities there is no project row to key on.
    const functions = read("studio.functions.ts");
    const block = functions.slice(functions.indexOf("studioGetProjectAmenities"));
    expect(block).toContain("slug: z.string()");
    expect(block).not.toMatch(/studioSaveProjectAmenities[\s\S]{0,400}projectId/);
  });

  it("does not extend the create flow's fact contract with amenities", () => {
    // `StudioProjectFacts` is a flat record of scalars and its schema is stripped
    // to exactly those keys. If amenities ever appear here, the create-flow
    // integration has begun and this whole file should be reconsidered.
    //
    // Every slice below is bounded by markers that are ASSERTED TO EXIST first.
    // The first revision of this test sliced on `export type StudioProjectFacts`
    // when the declaration is `export interface` — `indexOf` returned -1,
    // `slice(-1, 799)` returned the empty string, and the assertion passed
    // against nothing at all. A slice whose bounds are not checked is not a test.
    const types = read("studio-types.ts");
    const factsStart = types.indexOf("export interface StudioProjectFacts");
    expect(factsStart, "StudioProjectFacts is declared").toBeGreaterThan(-1);
    const factsEnd = types.indexOf("\n}", factsStart);
    expect(factsEnd, "StudioProjectFacts has a closing brace").toBeGreaterThan(factsStart);
    const facts = types.slice(factsStart, factsEnd);
    expect(facts.length, "the sliced declaration is non-empty").toBeGreaterThan(50);
    expect(facts).not.toMatch(/\bamenit/i);

    const functions = read("studio.functions.ts");
    const schemaStart = functions.indexOf("const projectFactsSchema");
    const schemaEnd = functions.indexOf("const resaleFactsSchema");
    expect(schemaStart, "projectFactsSchema exists").toBeGreaterThan(-1);
    expect(schemaEnd, "resaleFactsSchema follows it").toBeGreaterThan(schemaStart);
    const schema = functions.slice(schemaStart, schemaEnd);
    expect(schema.length, "the sliced schema is non-empty").toBeGreaterThan(50);
    expect(schema).not.toMatch(/\bamenit/i);
  });

  it("does not let the create flow reach the amenity save", () => {
    // The job-start path is where a create-flow integration would have to hook
    // in. Neither the endpoint's schema nor the service function that starts a
    // job may touch amenities while the deferral stands.
    const functions = read("studio.functions.ts");
    const startStart = functions.indexOf("const startJobSchema");
    expect(startStart, "startJobSchema exists").toBeGreaterThan(-1);
    const startEnd = functions.indexOf("export const", startStart);
    expect(startEnd, "the schema is followed by an endpoint").toBeGreaterThan(startStart);
    expect(functions.slice(startStart, startEnd)).not.toMatch(/\bamenit/i);

    const service = read("server/service.ts");
    const start = service.indexOf("export async function startUploadJob");
    expect(start, "startUploadJob exists").toBeGreaterThan(-1);
    const next = service.indexOf("\nexport ", start + 1);
    const body = service.slice(start, next > -1 ? next : undefined);
    expect(body.length, "the sliced function is non-empty").toBeGreaterThan(50);
    expect(body).not.toMatch(/\bamenit/i);
  });

  it("leaves the create-flow and ingest pipeline untouched by this feature", () => {
    // The amenities save is its own transaction against its own relation. It must
    // not have reached into project creation or the progressive ingest path.
    const service = read("server/service.ts");
    const start = service.indexOf("export async function saveProjectAmenities");
    expect(start, "saveProjectAmenities exists").toBeGreaterThan(-1);
    // Bounded by the NEXT exported function, not by a character count: a fixed
    // window runs into the neighbouring function, which legitimately does use the
    // progressive-ingest path.
    const nextExport = service.indexOf("\nexport ", start + 1);
    const save = service.slice(start, nextExport > -1 ? nextExport : undefined);
    expect(save).toContain("deps.data.saveProjectAmenities");
    for (const forbidden of [
      "buildProgressiveBatch",
      "deps.ingest",
      "startJob",
      "publishProject",
    ]) {
      expect(save, forbidden).not.toContain(forbidden);
    }
  });
});
