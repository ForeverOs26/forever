/**
 * End-to-end Factory behaviour.
 *
 * Every test here is one source-agnostic promise: a run works with only a
 * folder, only an archive, only a document, Drive without Telegram, Telegram
 * without Drive, and with no current price at all. The generated package is the
 * existing Direct Publish contract, so it is validated with the real
 * `readSourcePackage` / `assessPublishability` boundary rather than a mock.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { assessPublishability } from "@/features/forever-direct-publish/publishability";
import { readSourcePackage } from "@/features/forever-direct-publish/source-package";
import {
  assertProductionTarget,
  STAGING_PROJECT_REF,
} from "@/features/forever-direct-publish/target";
import {
  syntheticDisplayP3IccProfile,
  syntheticJpeg,
  syntheticJpegWithIccProfile,
  syntheticSrgbIccProfile,
} from "@/features/forever-studio/tests/media-truth-fixtures";

import type { ProductionIdentityReader } from "../identity";
import { runFactory, runFactoryBatch } from "../pipeline";
import { SOURCE_SET_SCHEMA_VERSION, type SourceSet } from "../source-set";

import {
  CONDO_AREA_PSQM_TOTAL,
  CONDO_AREA_TOTAL_PSQM,
  FakeIdentityReader,
  SOLD_NOTE,
  UNSUPPORTED_LAYOUT,
  productionProject,
} from "./fixtures";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "factory-pipeline-"));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Text extraction is injected so no test needs a PDF tool on the host. */
function textFrom(bytes: Buffer): string | null {
  const text = bytes.toString("utf8");
  return text.startsWith("%PDF")
    ? text.slice(9)
    : /^[\s\S]{0,50}[A-Za-z]/.test(text) && !text.startsWith("\xff\xd8")
      ? text
      : null;
}

/** Write a "PDF" whose text layer is the supplied schedule. */
function writeSchedule(directory: string, filename: string, text: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), `%PDF-1.4\n${text}`);
}

const EMPTY_PRODUCTION = new FakeIdentityReader([]);

/** No production view at all — what a generate-only run actually sees. */
const NO_PRODUCTION_VIEW: ProductionIdentityReader = {
  async listProjects() {
    return null;
  },
};

function sourceSet(sources: SourceSet["sources"], hint?: SourceSet["project_hint"]): SourceSet {
  return { schema_version: SOURCE_SET_SCHEMA_VERSION, project_hint: hint, sources };
}

async function run(set: SourceSet, reader: ProductionIdentityReader = EMPTY_PRODUCTION) {
  return runFactory(set, reader, { allowNetwork: false }, { textExtractor: textFrom });
}

describe("source-agnostic runs", () => {
  it("works with ONLY a local folder", async () => {
    const root = scratch();
    writeSchedule(root, "CLK - Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeFileSync(join(root, "coralina-render.jpg"), syntheticJpeg());

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "Coralina Kamala" }),
    );
    expect(result.identity.outcome).toBe("resolved_new");
    expect(result.counts.units).toBe(3);
    expect(result.counts.prices).toBe(3);
    expect(result.counts.media).toBeGreaterThan(0);
    expect(result.report.blocked).toBe(false);
  });

  it("works with ONLY one official document and no media at all", async () => {
    const root = scratch();
    writeSchedule(root, "MOB - Price list V.2. - Updated 17.07.2026.pdf", CONDO_AREA_TOTAL_PSQM);

    const result = await run(
      sourceSet(
        [
          {
            type: "official_document",
            location: join(root, "MOB - Price list V.2. - Updated 17.07.2026.pdf"),
          },
        ],
        { name: "The Modeva" },
      ),
    );
    expect(result.counts.units).toBe(3);
    expect(result.counts.media).toBe(0);
    // No hero is a warning, never a blocker.
    expect(result.report.blocked).toBe(false);
  });

  it("works with Telegram and no Drive", async () => {
    const root = scratch();
    writeSchedule(
      join(root, "downloads", "the-example", "42"),
      "EX - Price List V.1. - Updated 17.07.26.pdf",
      CONDO_AREA_PSQM_TOTAL,
    );

    const result = await run(
      sourceSet([{ type: "telegram_channel", channel: "theexample", archive_root: root }], {
        name: "The Example",
      }),
    );
    expect(result.counts.units).toBe(3);
    expect(result.report.blocked).toBe(false);
  });

  it("works with Drive listed and no Telegram, even with the network off", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.1. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    const result = await run(
      sourceSet(
        [
          { type: "google_drive_folder", folder_id: "abc123" },
          { type: "local_folder", location: root },
        ],
        { name: "The Example" },
      ),
    );
    // Drive contributed nothing and said so; the run still produced a package.
    expect(result.report.exceptions.some((e) => e.code === "network_not_enabled")).toBe(true);
    expect(result.report.blocked).toBe(false);
    expect(result.counts.units).toBe(3);
  });

  it("publishes with NO current price when no schedule exists", async () => {
    const root = scratch();
    writeFileSync(join(root, "brochure.pdf"), `%PDF-1.4\n${UNSUPPORTED_LAYOUT}`);
    writeFileSync(join(root, "example-render.jpg"), syntheticJpeg());

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.counts.prices).toBe(0);
    expect(result.report.blocked).toBe(false);
    expect(result.report.exceptions.some((e) => e.code === "current_price_missing")).toBe(true);
    expect(result.package?.batch.prices).toBeUndefined();
  });
});

describe("source precedence in a real run", () => {
  it("uses the newer of two conflicting schedules", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.1. - Updated 03.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_TOTAL_PSQM);

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.package?.manifest.price_source?.ref).toBe(
      "Price List V.2. - Updated 17.07.26.pdf",
    );
    expect(result.package?.manifest.price_source?.effective_date).toBe("2026-07-17");
  });

  it("lets a newer SOLD note override the schedule's availability", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeFileSync(join(root, "update - 23.07.26.txt"), SOLD_NOTE);

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    const sold = result.package?.batch.units?.find((unit) => unit.unit_code === "CKA201");
    expect(sold?.availability_status).toBe("sold");
    const stillAvailable = result.package?.batch.units?.find((unit) => unit.unit_code === "CKA202");
    expect(stillAvailable?.availability_status).toBe("available");
  });

  it("applies a SHORT-code SOLD note to the schedule's full unit code", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    // The developer's short form: "A201" for the schedule's "CKA201".
    writeFileSync(join(root, "update - 23.07.26.txt"), "SOLD A201");

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    const units = result.package!.batch.units!;
    // One home, not two: no phantom "A201" beside the real "CKA201".
    expect(units.map((unit) => unit.unit_code)).not.toContain("A201");
    expect(units.find((unit) => unit.unit_code === "CKA201")?.availability_status).toBe("sold");
    expect(units).toHaveLength(3);
    // The sold unit keeps its price row — the schedule still evidences it.
    expect(result.package!.batch.prices!.map((price) => price.unit_code)).toContain("CKA201");
  });

  it("reports an unmatchable SOLD note instead of inventing a unit for it", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeFileSync(join(root, "update - 23.07.26.txt"), "SOLD ZZ999");

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.package!.batch.units!.map((unit) => unit.unit_code)).not.toContain("ZZ999");
    expect(result.package!.batch.units).toHaveLength(3);
    expect(result.report.exceptions.some((e) => e.code === "availability_unit_unmatched")).toBe(
      true,
    );
    // Reported, but never a blocker.
    expect(result.report.blocked).toBe(false);
  });

  it("never marks a unit SOLD merely because a schedule omits it", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.package?.batch.units?.every((unit) => unit.availability_status !== "sold")).toBe(
      true,
    );
  });

  it("treats a byte-identical repost as no new evidence", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeSchedule(
      join(root, "repost"),
      "Price List V.2. - Updated 17.07.26.pdf",
      CONDO_AREA_PSQM_TOTAL,
    );

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.counts.reposts).toBe(1);
    expect(result.counts.prices).toBe(3);
  });
});

describe("media", () => {
  it("publishes a provably plain-sRGB image and retains Display P3 privately", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.1. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeFileSync(
      join(root, "example-srgb.jpg"),
      syntheticJpegWithIccProfile(syntheticSrgbIccProfile()),
    );
    writeFileSync(
      join(root, "example-p3.jpg"),
      syntheticJpegWithIccProfile(syntheticDisplayP3IccProfile()),
    );

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.media?.selected.some((item) => item.sourceRef === "example-srgb.jpg")).toBe(true);
    expect(result.media?.excluded).toContainEqual(
      expect.objectContaining({ ref: "example-p3.jpg", code: "unsupported_color_profile" }),
    );
    expect(result.media?.retainedPrivate).toContain("example-p3.jpg");
    expect(result.report.exceptions.some((e) => e.code === "media_unsupported")).toBe(true);
  });

  it("excludes AppleDouble sidecars before anything else", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.1. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeFileSync(join(root, "example-render.jpg"), syntheticJpeg());
    writeFileSync(join(root, "._example-render.jpg"), syntheticJpeg());

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.media?.selected.map((item) => item.sourceRef)).not.toContain(
      "._example-render.jpg",
    );
  });

  it("treats missing plans as ordinary, never as a blocker", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.1. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Example" }),
    );
    expect(result.report.blocked).toBe(false);
    expect(result.media?.selected.some((item) => item.mediaType === "floor_plan")).toBe(false);
  });
});

describe("generated package", () => {
  async function buildAndRead(name = "The Example") {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    writeFileSync(join(root, "example-cover.jpg"), syntheticJpeg());
    mkdirSync(join(root, "master-plan"));
    writeFileSync(join(root, "master-plan", "example-master-plan.jpg"), syntheticJpeg(false, 1, 7));
    return {
      root,
      result: await run(sourceSet([{ type: "local_folder", location: root }], { name })),
    };
  }

  it("is accepted by the existing Direct Publish reader and publishability floor", async () => {
    const { result } = await buildAndRead();
    const out = scratch();
    const directory = join(out, result.identity.slug!);
    mkdirSync(directory, { recursive: true });
    for (const [path, bytes] of result.package!.files) {
      const target = join(directory, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, bytes);
    }

    const pkg = await readSourcePackage(directory);
    expect(pkg.batch.batch_fingerprint).toBe(result.package!.batch.batch_fingerprint);
    const verdict = assessPublishability(pkg.batch);
    expect(verdict.ok).toBe(true);
  });

  it("round-trips each media file back to the media type it was selected as", async () => {
    const { result } = await buildAndRead();
    const out = scratch();
    const directory = join(out, result.identity.slug!);
    for (const [path, bytes] of result.package!.files) {
      const target = join(directory, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, bytes);
    }
    const pkg = await readSourcePackage(directory);
    const { planPublicMedia } = await import("@/features/forever-direct-publish/media-plan");
    const replanned = planPublicMedia(pkg.media, { slug: result.identity.slug! });
    const intended = new Map(
      result.package!.manifest.media.map((item) => [item.file, item.media_type]),
    );
    for (const item of replanned.items) {
      expect(item.mediaType).toBe(intended.get(item.path));
    }
  });

  it("produces the same fingerprint for the same inputs", async () => {
    const first = await buildAndRead();
    const second = await buildAndRead();
    expect(second.result.package!.batch.batch_fingerprint).toBe(
      first.result.package!.batch.batch_fingerprint,
    );
  });

  it("leaks no local path, no absolute path and no drive id", async () => {
    const { root, result } = await buildAndRead();
    const serialized = JSON.stringify({
      batch: result.package!.batch,
      manifest: result.package!.manifest,
    });
    expect(serialized).not.toContain(root);
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
    expect(serialized).not.toContain("t.me/");
    expect(serialized).not.toContain("drive.google.com");
    expect(serialized).not.toMatch(/joinchat|\+[A-Za-z0-9_-]{16}/);
  });

  it("emits only warning entities and severities the review queue can store", async () => {
    const { result } = await buildAndRead();
    const verdict = assessPublishability(result.package!.batch);
    expect(verdict.ok).toBe(true);
    for (const warning of result.package!.batch.warnings ?? []) {
      expect([
        "project",
        "listing",
        "developer",
        "location",
        "building",
        "unit",
        "price",
        "media",
        "document",
      ]).toContain(warning.entity);
      expect(["info", "warning"]).toContain(warning.severity);
    }
  });

  it("never renames a live project when production was not consulted", async () => {
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_TOTAL_PSQM);
    // No production view (the default offline reader), plus an Owner-stated slug.
    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], {
        name: "The Modeva",
        existing_slug: "modeva",
      }),
      NO_PRODUCTION_VIEW,
    );
    expect(result.package!.batch.mode).toBe("enrich");
    expect(result.package!.batch.project.slug).toBe("modeva");
    // The stored name is canonical and unknown here, so `name` is not written.
    expect(result.package!.batch.project.set).not.toHaveProperty("name");
    // Official-source evidence still exists, so publishability is satisfied.
    expect(assessPublishability(result.package!.batch).ok).toBe(true);
  });

  it("builds an enrich package that preserves the stored slug for an update", async () => {
    const reader = new FakeIdentityReader([productionProject("modeva", "Modeva")]);
    const root = scratch();
    writeSchedule(root, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_TOTAL_PSQM);
    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "The Title Modeva" }),
      reader,
    );
    expect(result.identity.operation).toBe("update");
    expect(result.package!.batch.mode).toBe("enrich");
    expect(result.package!.batch.project.slug).toBe("modeva");
    expect(result.package!.batch.project.publish).toBe(true);
  });
});

describe("identity exceptions", () => {
  it("returns exactly one narrow identity exception and generates nothing", async () => {
    const reader = new FakeIdentityReader([
      productionProject("sierra-bangtao", "Sierra Bangtao"),
      productionProject("sierra-kamala", "Sierra Kamala"),
    ]);
    const root = scratch();
    writeSchedule(root, "Price List V.1. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);

    const result = await run(
      sourceSet([{ type: "local_folder", location: root }], { name: "Sierra" }),
      reader,
    );
    expect(result.package).toBeNull();
    const blockers = result.report.exceptions.filter((e) => e.severity === "blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].code).toBe("ambiguous_identity");
  });
});

describe("batch independence", () => {
  it("keeps a valid project's package when another project in the batch is blocked", async () => {
    const good = scratch();
    writeSchedule(good, "Price List V.2. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);
    const ambiguous = scratch();
    writeSchedule(ambiguous, "Price List V.1. - Updated 17.07.26.pdf", CONDO_AREA_PSQM_TOTAL);

    const reader = new FakeIdentityReader([
      productionProject("sierra-bangtao", "Sierra Bangtao"),
      productionProject("sierra-kamala", "Sierra Kamala"),
    ]);

    const outcomes = await runFactoryBatch(
      [
        {
          name: "ambiguous",
          sourceSet: sourceSet([{ type: "local_folder", location: ambiguous }], { name: "Sierra" }),
        },
        {
          name: "good",
          sourceSet: sourceSet([{ type: "local_folder", location: good }], { name: "The Example" }),
        },
        {
          name: "unreadable",
          sourceSet: sourceSet([{ type: "local_folder", location: join(good, "nope") }], {
            name: "Missing Source",
          }),
        },
      ],
      reader,
      { allowNetwork: false },
      { textExtractor: textFrom },
    );

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0].report.blocked).toBe(true);
    expect(outcomes[0].result?.package).toBeNull();
    // The good project still produced a complete package.
    expect(outcomes[1].report.blocked).toBe(false);
    expect(outcomes[1].result?.counts.units).toBe(3);
    // A source that could not be read is that project's own attention item.
    expect(outcomes[2].report.exceptions.some((e) => e.code === "source_unreadable")).toBe(true);
  });
});

describe("warning vocabulary", () => {
  it("is enforced by the shared publishability floor, before any upload", () => {
    const rejected = assessPublishability({
      schema_version: "1",
      mode: "create",
      batch_fingerprint: "0".repeat(64),
      project: { slug: "the-example", name: "The Example" },
      prices: [{ unit_code: "A1", price: 1, source_file: "price.pdf" }],
      warnings: [
        // `source` is not a storable entity; the review queue would reject it
        // mid-publish, after media had already been uploaded.
        { entity: "source" as never, code: "x", severity: "info", message: "m" },
      ],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected).toMatchObject({ failure: { code: "warning_entity_unsupported" } });
  });
});

describe("staging refusal", () => {
  it("refuses staging by ref, and only accepts the production origin", () => {
    expect(() =>
      assertProductionTarget({
        supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co`,
        requestedTarget: "production",
      }),
    ).toThrowError(expect.objectContaining({ code: "target_is_staging" }));

    expect(() =>
      assertProductionTarget({
        supabaseUrl: "https://abtvsrcnfwlbawvrjeed.supabase.co",
        requestedTarget: "staging",
      }),
    ).toThrowError(expect.objectContaining({ code: "target_not_production" }));

    expect(
      assertProductionTarget({
        supabaseUrl: "https://abtvsrcnfwlbawvrjeed.supabase.co",
        requestedTarget: "production",
      }).projectRef,
    ).toBe("abtvsrcnfwlbawvrjeed");
  });
});
