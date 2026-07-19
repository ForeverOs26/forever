import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyReadiness, runIntake } from "../run";

const FIXED_NOW = new Date("2026-07-19T00:00:00.000Z");

const FULL_FACTS = {
  name: {
    value: "Readiness Project",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
  developer: {
    value: "Dev Co",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
  location: {
    value: "Kamala, Phuket, Thailand",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
  country: {
    value: "Thailand",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
};

function unitRow(code: string, building: string, price: string | null) {
  return {
    unit_number: { value: code, source_file: "pl.json", confidence: "high" },
    building: { value: building, source_file: "pl.json", confidence: "high" },
    price:
      price === null
        ? { value: null, source_file: "pl.json", confidence: "none" }
        : { value: price, source_file: "pl.json", confidence: "high" },
  };
}

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "intake-ready-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function makeSource(
  name: string,
  opts: { facts?: unknown; rows?: unknown[]; extraFiles?: Record<string, string> },
): string {
  const dir = join(base, name);
  mkdirSync(join(dir, "facts"), { recursive: true });
  if (opts.facts !== undefined) {
    writeFileSync(join(dir, "facts", "project-facts.json"), JSON.stringify(opts.facts));
  }
  if (opts.rows) {
    mkdirSync(join(dir, "price-list"), { recursive: true });
    writeFileSync(
      join(dir, "price-list", "price-list.json"),
      JSON.stringify({ unit_inventory: opts.rows }),
    );
  }
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
function run(slug: string, dir: string) {
  // Match FULL_FACTS.name so a name difference never adds a substantive warning.
  return runIntake({
    projectSlug: slug,
    projectName: "Readiness Project",
    sources: [dir],
    outRoot: join(base, "out"),
    workspaceRoot: join(base, "ws"),
    now: FIXED_NOW,
  });
}

describe("classifyReadiness (unit)", () => {
  const counts = (b: number, u: number, p: number) => ({
    projects: 1,
    buildings: b,
    units: u,
    prices: p,
    media: 0,
    warnings: 0,
    batches: 1,
  });
  it("is READY for a meaningful graph with no substantive warnings", () => {
    expect(
      classifyReadiness({
        counts: counts(1, 3, 3),
        payloadWarningCodes: ["developer_unresolved", "coordinates_missing"],
      }),
    ).toBe("READY_FOR_DRAFT_IMPORT");
  });
  it("is PARTIAL when a substantive warning is present", () => {
    expect(
      classifyReadiness({ counts: counts(1, 3, 3), payloadWarningCodes: ["price_missing"] }),
    ).toBe("PARTIAL_READY_WITH_WARNINGS");
  });
  it("is PARTIAL when the graph is not structurally meaningful", () => {
    expect(classifyReadiness({ counts: counts(0, 0, 0), payloadWarningCodes: [] })).toBe(
      "PARTIAL_READY_WITH_WARNINGS",
    );
  });
});

describe("readiness end-to-end", () => {
  it("READY: full facts, complete prices, no media (missing media never blocks)", async () => {
    const dir = makeSource("ready", {
      facts: FULL_FACTS,
      rows: [unitRow("A-1", "A", "1000000"), unitRow("A-2", "A", "1100000")],
    });
    const result = await run("ready", dir);
    expect(result.status).toBe("READY_FOR_DRAFT_IMPORT");
    expect(result.exitCode).toBe(0);
  });

  it("PARTIAL: name only (no structured graph)", async () => {
    const dir = makeSource("nameonly", { facts: FULL_FACTS });
    const result = await run("nameonly", dir);
    expect(result.status).toBe("PARTIAL_READY_WITH_WARNINGS");
    expect(result.summary.planned_graph_counts).toMatchObject({
      buildings: 0,
      units: 0,
      prices: 0,
    });
  });

  it("PARTIAL: unsupported files only", async () => {
    const dir = makeSource("unsuponly", {
      facts: FULL_FACTS,
      extraFiles: { "misc/notes.xyz": "freeform" },
    });
    const result = await run("unsuponly", dir);
    expect(result.status).toBe("PARTIAL_READY_WITH_WARNINGS");
    expect(result.summary.unsupported_files.length).toBeGreaterThan(0);
  });

  it("PARTIAL: missing country and missing currency", async () => {
    const { country: _c, ...noCountry } = FULL_FACTS;
    const dir = makeSource("nocountry", {
      facts: noCountry,
      rows: [unitRow("A-1", "A", "1000000")],
    });
    const result = await run("nocountry", dir);
    expect(result.status).toBe("PARTIAL_READY_WITH_WARNINGS");
  });

  it("BLOCKED: malformed structured JSON", async () => {
    const dir = join(base, "malformed");
    mkdirSync(join(dir, "price-list"), { recursive: true });
    writeFileSync(join(dir, "price-list", "price-list.json"), "{ broken ");
    const result = await run("malformed", dir);
    expect(result.status).toBe("BLOCKED");
    expect(result.exitCode).not.toBe(0);
  });

  it("BLOCKED: duplicate unit identifiers (conflict)", async () => {
    const dir = makeSource("conflict", {
      facts: FULL_FACTS,
      rows: [unitRow("A-1", "A", "1000000"), unitRow("A-1", "A", "2000000")],
    });
    const result = await run("conflict", dir);
    expect(result.status).toBe("BLOCKED");
    expect(result.exitCode).toBe(3);
  });
});
