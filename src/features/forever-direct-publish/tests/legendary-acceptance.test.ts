/**
 * The Title Legendary — acceptance over the REAL committed payload
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001, Phases 6 and 8).
 *
 * This reads the actual prepared batch from
 * `forever-data/projects/the-title-legendary/progressive/payload.json` rather
 * than a fixture, so the assertions below are statements about the data that
 * will really be published: 9 buildings, 63 units, 63 official prices, the I501
 * SOLD override from the newer Telegram source, and 16 warnings none of which
 * may block publication.
 *
 * It runs entirely offline against the in-memory production stand-in: no
 * network, no credential, and no write to any real database.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ProgressiveBatch } from "../../forever-ingestion/batch-types";
import { assessPublishability } from "../publishability";
import { publishProject } from "../publish";
import type { SourcePackage } from "../source-package";
import { isPublicationBlocking } from "../trust";
import { FakeProductionWorld, OWNER_AUTHORIZATION } from "./fakes";

const PAYLOAD_PATH = "forever-data/projects/the-title-legendary/progressive/payload.json";
const batch = JSON.parse(
  readFileSync(resolve(process.cwd(), PAYLOAD_PATH), "utf8"),
) as ProgressiveBatch;

function legendaryPackage(): SourcePackage {
  return {
    ref: "the-title-legendary",
    directory: "/owner-local/the-title-legendary",
    // Structured clone so one test can never mutate another's input.
    batch: structuredClone(batch),
    media: [],
    manifest: null,
    skipped: [],
  };
}

describe("The Title Legendary prepared payload", () => {
  it("is the expected project at the expected scale", () => {
    expect(batch.project.slug).toBe("the-title-legendary");
    expect(batch.project.name).toBe("The Title Legendary Bang-Tao");
    expect(batch.project.construction_status).toBe("Completed");
    expect(batch.buildings).toHaveLength(9);
    expect(batch.units).toHaveLength(63);
    expect(batch.prices).toHaveLength(63);
  });

  it("carries the newer SOLD override for I501", () => {
    const i501 = batch.units?.find((unit) => unit.unit_code === "I501");
    expect(i501?.availability_status).toBe("sold");
    // The override is evidenced, not assumed: a newer official source wins.
    const metadata = i501?.metadata as Record<string, unknown> | undefined;
    expect(metadata?.availability_override).toMatchObject({
      price_list_value: "available",
      current_value: "sold",
    });
  });

  it("still has unresolved canonical references — which must not block it", () => {
    // These are precisely the fields the Owner decision says publish as raw
    // name / null rather than gating on.
    expect(batch.project.developer_id).toBeNull();
    expect(batch.project.location_id).toBeNull();
    expect(batch.project.developer_name_raw).toBe("Rhom Bho Property");
    expect(batch.project.location_name_raw).toBe("Bang Tao, Phuket, Thailand");
  });

  it("meets the minimum publication requirements", () => {
    const verdict = assessPublishability(batch);
    expect(verdict.ok).toBe(true);
  });

  it("carries no warning that blocks publication", () => {
    const warnings = batch.warnings ?? [];
    expect(warnings.length).toBeGreaterThan(0);
    const blocking = warnings.filter(isPublicationBlocking);
    expect(blocking).toEqual([]);
    // Including the agent-facing source label itself.
    expect(warnings.map((warning) => warning.code)).toContain("source_marked_internal_use_only");
  });

  it("is authored as an unpublished draft, and direct publish overrides that", async () => {
    // The prepared payload deliberately says publish:false (it was built for
    // the retired draft workflow). Direct mode must not honour it.
    expect(batch.project.publish).toBe(false);

    const world = new FakeProductionWorld();
    const result = await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);

    expect(result.status).toBe("published");
    expect(world.directPublishCalls.at(-1)!.batch.project.publish).toBe(true);
    expect(world.find("the-title-legendary")!.publicStatus).toBe("published");
  });

  it("publishes to the expected public URL with the full inventory", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);

    expect(result.status).toBe("published");
    expect(result.publicPath).toBe("/projects/the-title-legendary");
    expect(result.publicUrl).toBe("https://forever.example/projects/the-title-legendary");
    expect(result.counts).toMatchObject({ buildings: 9, units: 63, prices: 63 });
    expect(result.errorCode).toBeNull();
  });

  it("shows I501 as sold, not available, once published", async () => {
    const world = new FakeProductionWorld();
    await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);
    const i501 = world.units.find((unit) => unit.unitCode === "I501");
    expect(i501?.availability).toBe("sold");
    expect(i501?.availability).not.toBe("available");
  });

  it("leaves no persisted draft and creates exactly one project", async () => {
    const world = new FakeProductionWorld();
    await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);
    expect(world.projects).toHaveLength(1);
    expect(world.projects.filter((project) => project.publicStatus === "draft")).toEqual([]);
  });

  it("republishing the same package creates no duplicate project, unit or price rows", async () => {
    const world = new FakeProductionWorld();
    await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);
    await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);
    const third = await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);

    expect(third.status).toBe("published");
    expect(world.projects).toHaveLength(1);
    expect(world.buildings).toHaveLength(9);
    expect(world.units).toHaveLength(63);
    expect(world.prices).toHaveLength(63);
  });

  it("changes nothing about any unrelated project", async () => {
    const world = new FakeProductionWorld();
    // A pre-existing published project, as production already has.
    world.projects.push({
      id: "existing-modeva",
      slug: "modeva",
      name: "Modeva",
      publicStatus: "published",
      isActive: true,
      mainImageUrl: "https://example.test/modeva.jpg",
      fields: {},
    });
    const before = structuredClone(world.projects[0]);

    await publishProject(legendaryPackage(), world.deps(), OWNER_AUTHORIZATION);

    expect(world.projects.find((project) => project.slug === "modeva")).toEqual(before);
    expect(world.projects).toHaveLength(2);
  });
});
