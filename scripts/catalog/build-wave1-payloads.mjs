/**
 * FOREVER-CATALOG-10-002 — Wave 1 progressive draft payload builder.
 *
 * Regenerates the three Wave 1 payloads that this task authors:
 *
 *   - rainpalm-villas  structural-only rebuild (prices deliberately removed)
 *   - garden-of-eden   Passport Light from the January 2026 deck
 *   - the-title-sierra Passport Light plus the 2026-05-15 unit price list
 *
 * Coralina is NOT rebuilt. Its canonical package already exists, validates and
 * reproduces its recorded hashes; re-deriving it would risk drift.
 *
 * The builder is deterministic: same inputs -> byte-identical payloads and
 * identical `batch_fingerprint` values. It invents nothing. Every populated
 * field traces to a source document; everything absent stays absent and is
 * recorded as an explicit warning.
 *
 * Source documents live outside the repository, in Owner intake roots. They are
 * never copied into it, and their absolute paths are never committed: only the
 * filename, SHA-256 digest and byte length are pinned here. Each run resolves
 * the filenames against the roots named by FOREVER_WAVE1_SOURCE_ROOTS and
 * verifies the digest, so a changed or substituted source fails closed instead
 * of silently producing a different draft.
 *
 * Usage:
 *   set FOREVER_WAVE1_SOURCE_ROOTS=<root1>;<root2>
 *   node scripts/catalog/build-wave1-payloads.mjs [--check]
 *
 * `--check` rebuilds in memory and fails if the committed payloads differ.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK_ONLY = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Canonical fingerprint — byte-identical to
// src/features/forever-ingestion/build-batch.ts::fingerprintBatch.
// ---------------------------------------------------------------------------

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

function fingerprintBatch(batch) {
  return createHash("sha256").update(stableStringify(batch), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Pinned Owner source documents. Paths are Owner intake roots, never repository
// paths. A digest mismatch is a hard failure.
// ---------------------------------------------------------------------------

const SOURCES = {
  sierraPriceList: {
    citation: "SIB - Price List V.1. - Updated 15.05.2026.pdf",
    sha256: "8e743d1fb6ba8ea1a4985a09ebd38ab1107c03f57e9640f1559b279213217e3b",
    bytes: 248412,
  },
  sierraMasterPlan: {
    citation: "SIB - Master Plan Price list V.1 - updated 15.05.26.pdf",
    sha256: "582c41e3642ae475ed2539a9d428dff28141117dabd3db9d72f53b7a0450ac4a",
    bytes: 1786548,
  },
  gardenOfEdenEng: {
    citation: "GARDEN OF EDEN - eng.pdf",
    sha256: "9c4a2abeddf4d1b687598824d98fef9220e4c5f015eb58c95687a60e165e3cde",
    bytes: 11156967,
  },
  gardenOfEdenRus: {
    citation: "GARDEN OF EDEN.pdf",
    sha256: "ac5cfa99a55867d8c78c8397230356732da1b140f25b69945480ccbb40221ca6",
    bytes: 6885501,
  },

  // Rainpalm. These are the documents the build actually reads and the ones
  // whose digests appear in the payload; every one is resolved and verified on
  // both a normal build and a `--check` run.
  rainpalmFacts: {
    citation: "project-facts.json",
    sha256: "1e47032269fe2cd48ed93f436075915a05e1be7380d2afc58ce793e55d5c795b",
    bytes: 1315,
  },
  rainpalmInventory: {
    citation: "price-list.json",
    sha256: "6ce4a187711f1fdcc26eed84689a0ef0f7a461262a4630b895c251781d10a73f",
    bytes: 43890,
  },
  rainpalmPresentation: {
    citation: "For PDF Presentation.pdf",
    sha256: "9887f0ffe03cf294eefd60b15a99578c11fb08981a86dc40b6909f663d30df38",
    bytes: 10664808,
  },
  rainpalmPriceOriginal: {
    citation: "Rainpalm - Price List（for In house).pdf",
    sha256: "08b4ceb9a71c7dc292cbfec6bf5d34c419687e6097c2d75e25b865ed0a459faf",
    bytes: 77942,
  },
  rainpalmPrice042025: {
    citation: "Rainpalm - Price List（for In house) update 04.2025.pdf",
    sha256: "4ddee05fe5063bd8548ca8d2833c20bb4ca9b6b81a23aee8f21b065e1b5260b6",
    bytes: 77091,
  },
  rainpalmPrice4122025: {
    citation: "Rainpalm - Price List（for In house) update 4_12_2025.pdf",
    sha256: "ac1c213b547d00d5c620cf152a0855c350cb4e193d302ac370ede971f8ae9535",
    bytes: 78944,
  },
  rainpalmPriceNew: {
    citation: "Rainpalm - Price List new.pdf",
    sha256: "772c02f01d030a56dd03512298bb881ccf3d0b7764bd665877a4f6a9ddaf4441",
    bytes: 78261,
  },
};

/**
 * The four conflicting Rainpalm price documents. Only the annotations live
 * here; the identity fields (filename, digest, size) come from the verified
 * SOURCES entries at build time, so nothing is reported that was not resolved.
 */
const RAINPALM_PRICE_DOCUMENT_NOTES = [
  {
    key: "rainpalmPriceOriginal",
    extractable_prices: 14,
    stated_source_date: null,
    note: "No issue date inside the document; the filename carries none either.",
  },
  {
    key: "rainpalmPrice042025",
    extractable_prices: 9,
    stated_source_date: null,
    note: "The only variant with a qualified SIP extraction chain. Supports 9 of the 14 previously asserted prices; renders D4 as Reserved.",
  },
  {
    key: "rainpalmPrice4122025",
    extractable_prices: 21,
    stated_source_date: null,
    note: "Prices all 21 villas with an entirely different schedule (~8-10% below the previously asserted set). Whether 4_12_2025 means 4 December 2025 or 12 April 2025 is not determinable from the filename.",
  },
  {
    key: "rainpalmPriceNew",
    extractable_prices: 14,
    stated_source_date: null,
    note: "Identical 14 values to the undated original. Not confirmed by the Owner to be the same document under a different name.",
  },
];

/**
 * Cited by every field of the Rainpalm intake inventory, and by every price row
 * of the retired package, but not present on disk. The build proves this on
 * every run rather than asserting it from a past observation.
 */
const RAINPALM_CITED_BUT_ABSENT = "Копия Rainpalm - Price List（for In house)-1.pdf";

/** Cited for currency by the intake inventory; also absent (the real file has no `-1`). */
const RAINPALM_CURRENCY_CITED_BUT_ABSENT = "Rainpalm Legal and Ownership.pdf (1)-1.pdf";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Owner intake roots, supplied at run time so no Owner path is ever committed.
 * Semicolon-separated; each root is searched for the pinned filename.
 */
function sourceRoots() {
  const raw = process.env.FOREVER_WAVE1_SOURCE_ROOTS ?? "";
  const roots = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!roots.length) {
    throw new Error(
      "FOREVER_WAVE1_SOURCE_ROOTS is not set. Point it at the Owner intake folders holding the pinned Wave 1 source documents (semicolon-separated).",
    );
  }
  return roots;
}

/** Bounded recursive walk of a configured root. Depth-limited and sorted, so
 * resolution order is deterministic regardless of filesystem enumeration. */
const MAX_SEARCH_DEPTH = 4;

function walk(root, depth = 0) {
  if (depth > MAX_SEARCH_DEPTH) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, depth + 1));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function allSourceFiles() {
  return sourceRoots().flatMap((root) => walk(root));
}

/**
 * Resolve a pinned source by filename across every configured root, then prove
 * identity by digest AND byte size. A same-name file with different content is
 * a hard failure, never a silent substitution. The resolved absolute path is
 * used but never recorded in any payload.
 */
function requireSource(key) {
  const source = SOURCES[key];
  const matches = allSourceFiles().filter((path) => basename(path) === source.citation);
  if (!matches.length) {
    throw new Error(
      `source_missing: ${source.citation} was not found in any configured root (expected sha256 ${source.sha256}).`,
    );
  }
  const verified = [];
  const rejected = [];
  for (const path of matches) {
    const actualBytes = statSync(path).size;
    const actualSha = sha256File(path);
    if (actualSha === source.sha256 && actualBytes === source.bytes) verified.push(path);
    else rejected.push({ path: basename(path), actualSha, actualBytes });
  }
  if (!verified.length) {
    throw new Error(
      `source_digest_mismatch: ${source.citation} resolved to ${matches.length} file(s), none matching the pinned identity ` +
        `(expected sha256 ${source.sha256}, ${source.bytes} bytes; found ${rejected
          .map((r) => `${r.actualSha}/${r.actualBytes}B`)
          .join(", ")}).`,
    );
  }
  return { ...source, path: verified[0] };
}

/**
 * Prove a cited-but-missing document is still missing. If it appears, the build
 * stops for review rather than quietly continuing with a warning that has
 * become false.
 */
function assertStillAbsent(filename, context) {
  const hits = allSourceFiles().filter((path) => basename(path) === filename);
  if (hits.length) {
    throw new Error(
      `cited_source_reappeared: "${filename}" is now present in a configured source root ` +
        `(${hits.length} match(es)). ${context} This build refuses to continue: the payload's ` +
        `absence warning would be false, and the document must be reviewed and pinned first.`,
    );
  }
}

/**
 * Xpdf `pdftotext -table`. The SIP contract (src/intake/sip/pdf-tool.ts) permits
 * table mode only for an Xpdf build, so the vendor is asserted before use.
 */
function pdfToTableText(path) {
  // Xpdf prints its version banner on stderr and may exit non-zero for `-v`.
  const probe = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
  const banner = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  if (!/xpdfreader\.com/i.test(banner)) {
    throw new Error("pdftotext_table_mode_requires_xpdf: local pdftotext is not an Xpdf build.");
  }
  const workspace = mkdtempSync(join(tmpdir(), "forever-wave1-"));
  try {
    const out = join(workspace, "out.txt");
    execFileSync("pdftotext", ["-table", path, out], { stdio: ["ignore", "pipe", "pipe"] });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Field provenance. Statuses and the 0..1 confidence scale come from
 * src/features/forever-ingestion/provenance.ts.
 *
 * `developer_provided` + `official_project_material` + confidence 1 is reserved
 * for a fact stated in first-party developer material whose citation resolves to
 * a document this build verified. Anything weaker must say so.
 */
function provenance(sourceRef, status = "developer_provided", options = {}) {
  const { sourceType = "official_project_material", confidence = 1, note, sourceDate } = options;
  const result = {
    status,
    source_type: sourceType,
    source_ref: sourceRef,
    confidence,
  };
  if (sourceDate) result.source_date = sourceDate;
  if (note) result.note = note;
  return result;
}

/**
 * A fact taken from an agency/internal presentation rather than developer
 * material. Never `developer_provided`, never `official_project_material`.
 */
function agencyProvenance(sourceRef, sourceDate) {
  return provenance(sourceRef, "extracted", {
    sourceType: "agency_investment_presentation",
    confidence: 0.5,
    sourceDate,
    note: "Extracted from a SunThai Property agency investment presentation. Not developer-issued material; no developer or official confirmation is implied.",
  });
}

/**
 * A fact taken from an operator-authored intake artifact whose own upstream
 * citation could not be resolved to a document on disk.
 */
function intakeProvenance(sourceRef, citedButAbsent) {
  return provenance(sourceRef, "extracted", {
    sourceType: "operator_intake",
    confidence: 0.5,
    note: `Value read from the verified operator intake artifact "${sourceRef}". That artifact cites "${citedButAbsent}", which is absent from every configured source root, so the upstream chain is unresolved and this value is not independently document-backed.`,
  });
}

function emit(slug, payload) {
  const { batch_fingerprint: _ignored, ...body } = payload;
  void _ignored;
  const complete = { ...body, batch_fingerprint: fingerprintBatch(body) };
  const text = `${JSON.stringify(complete, null, 2)}\n`;
  const target = join(REPO_ROOT, "forever-data", "projects", slug, "progressive", "payload.json");

  if (CHECK_ONLY) {
    const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
    const same = existing === text;
    console.log(
      `${same ? "UNCHANGED" : "DIFFERS  "} ${slug} fingerprint=${complete.batch_fingerprint}`,
    );
    if (!same) process.exitCode = 1;
    return complete;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
  const payloadSha = createHash("sha256").update(readFileSync(target)).digest("hex");
  console.log(
    `WROTE ${slug}\n` +
      `  payload_sha256    = ${payloadSha}\n` +
      `  batch_fingerprint = ${complete.batch_fingerprint}\n` +
      `  buildings=${(complete.buildings ?? []).length} units=${(complete.units ?? []).length} ` +
      `prices=${(complete.prices ?? []).length} media=${(complete.media ?? []).length} ` +
      `warnings=${(complete.warnings ?? []).length}`,
  );
  return complete;
}

// ---------------------------------------------------------------------------
// 1. Rainpalm Villas — structural-only rebuild
// ---------------------------------------------------------------------------

/**
 * The retired Fast Intake v1 package. It is a deterministic cross-check only —
 * never the evidence for a business fact. Every value below is read from a
 * verified Owner source; the package is used solely to prove the rebuild did
 * not silently change the unit set.
 */
const RAINPALM_FAST_INTAKE_SHA256 =
  "c95fb84744d9c067a003284be3fd8de5a2a84a2f9cf03a36b2c78b72d283a9b7";

function factValue(fact, label) {
  const value = fact?.value;
  if (value == null || String(value).trim() === "") {
    throw new Error(`rainpalm_source_incomplete: ${label} is absent from the verified source.`);
  }
  return String(value).trim();
}

function buildRainpalm() {
  // Every Rainpalm source whose digest this build reports is resolved and
  // verified here, on both a normal run and a `--check` run.
  const facts = requireSource("rainpalmFacts");
  const inventory = requireSource("rainpalmInventory");
  const presentation = requireSource("rainpalmPresentation");
  const priceDocuments = RAINPALM_PRICE_DOCUMENT_NOTES.map((entry) => {
    const source = requireSource(entry.key);
    return {
      file: source.citation,
      sha256: source.sha256,
      bytes: source.bytes,
      extractable_prices: entry.extractable_prices,
      stated_source_date: entry.stated_source_date,
      note: entry.note,
    };
  });

  // Prove — do not assume — that the cited documents are still missing.
  assertStillAbsent(
    RAINPALM_CITED_BUT_ABSENT,
    "It is cited by every field of the Rainpalm intake inventory and by every price row of the retired package.",
  );
  assertStillAbsent(
    RAINPALM_CURRENCY_CITED_BUT_ABSENT,
    "It is cited by the intake inventory for currency.",
  );

  const factsDocument = JSON.parse(readFileSync(facts.path, "utf8"));
  const inventoryDocument = JSON.parse(readFileSync(inventory.path, "utf8"));

  // Project identity comes from the verified facts artifact, whose citations
  // resolve to the verified presentation PDF. That chain is complete, so these
  // fields keep developer-provided provenance.
  const identityRef = (fact) => String(fact.source_ref ?? presentation.citation);
  const project = {
    slug: "rainpalm-villas",
    name: factValue(factsDocument.name, "project name"),
    developer_id: null,
    location_id: null,
    publish: false,
    developer_name_raw: factValue(factsDocument.developer, "developer raw name"),
    location_name_raw: factValue(factsDocument.location, "location"),
    location_area: factValue(factsDocument.location_area, "location area"),
    project_type: factValue(factsDocument.project_type, "project type"),
    short_description: factValue(factsDocument.short_description, "short description"),
    field_provenance: {
      name: provenance(identityRef(factsDocument.name)),
      developer_name_raw: provenance(identityRef(factsDocument.developer)),
      location_name_raw: provenance(identityRef(factsDocument.location)),
      location_area: provenance(identityRef(factsDocument.location_area)),
      project_type: provenance(identityRef(factsDocument.project_type)),
      short_description: provenance(identityRef(factsDocument.short_description)),
    },
  };

  const inventoryRows = inventoryDocument.unit_inventory;
  if (!Array.isArray(inventoryRows) || !inventoryRows.length) {
    throw new Error("rainpalm_source_incomplete: the intake inventory holds no unit rows.");
  }

  // Structural layer only: identifier, type, bedrooms, bathrooms, size — each
  // read from the verified inventory and each carrying its own provenance.
  // Availability is deliberately not imported: every availability value derives
  // from the disputed price documents, and D4 is in open conflict.
  const unitProvenance = intakeProvenance(inventory.citation, RAINPALM_CITED_BUT_ABSENT);
  const units = inventoryRows
    .map((row) => {
      const code = factValue(row.unit_number, "unit code");
      const unit = {
        unit_code: code,
        unit_type: factValue(row.unit_type, `unit ${code} type`),
        bedrooms: Number(factValue(row.bedrooms, `unit ${code} bedrooms`)),
        bathrooms: Number(factValue(row.bathrooms, `unit ${code} bathrooms`)),
        size_sqm: Number(factValue(row.size_sqm, `unit ${code} size`)),
        metadata: {
          field_provenance: {
            unit_type: unitProvenance,
            bedrooms: unitProvenance,
            bathrooms: unitProvenance,
            size_sqm: unitProvenance,
          },
        },
      };
      for (const [key, value] of Object.entries(unit)) {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error(`rainpalm_source_incomplete: unit ${code} has a non-numeric ${key}.`);
        }
      }
      return unit;
    })
    .sort((a, b) => (a.unit_code < b.unit_code ? -1 : a.unit_code > b.unit_code ? 1 : 0));

  // Deterministic cross-check against the retired package. A divergence means
  // the rebuild changed the business facts and must be reviewed, not shipped.
  const retiredPath = join(
    REPO_ROOT,
    "forever-data",
    "projects",
    "rainpalm-villas",
    "progressive",
    "payload.fast-intake-v1.json",
  );
  const retiredSha = sha256File(retiredPath);
  if (retiredSha !== RAINPALM_FAST_INTAKE_SHA256) {
    throw new Error(
      `rainpalm_crosscheck_input_changed: expected ${RAINPALM_FAST_INTAKE_SHA256}, found ${retiredSha}`,
    );
  }
  const retired = JSON.parse(readFileSync(retiredPath, "utf8"));
  const retiredUnits = new Map(retired.units.map((unit) => [unit.unit_code, unit]));
  if (retiredUnits.size !== units.length) {
    throw new Error(
      `rainpalm_unit_set_diverged: rebuilt ${units.length} units, retired package had ${retiredUnits.size}.`,
    );
  }
  for (const unit of units) {
    const previous = retiredUnits.get(unit.unit_code);
    if (!previous) throw new Error(`rainpalm_unit_set_diverged: ${unit.unit_code} is new.`);
    for (const field of ["unit_type", "bedrooms", "bathrooms", "size_sqm"]) {
      if (previous[field] !== unit[field]) {
        throw new Error(
          `rainpalm_unit_field_diverged: ${unit.unit_code}.${field} — source says ${JSON.stringify(unit[field])}, retired package said ${JSON.stringify(previous[field])}.`,
        );
      }
    }
  }

  const d4 = inventoryRows.find((row) => row.unit_number?.value === "D4");
  const d4Availability = d4?.availability_status?.value ?? null;

  const warnings = [
    {
      entity: "project",
      code: "country_missing",
      severity: "warning",
      message:
        "No source-backed country was provided; currency cannot be inferred and remains NULL unless a price row states it.",
    },
    {
      entity: "project",
      field: "latitude",
      code: "coordinates_missing",
      severity: "info",
      message: "No coordinates are stated in the verified source; latitude/longitude remain NULL.",
    },
    {
      entity: "project",
      field: "construction_status",
      code: "construction_status_missing",
      severity: "info",
      message:
        "No construction status or completion date is stated in the verified source; these remain NULL.",
    },
    {
      entity: "developer",
      code: "developer_unresolved",
      severity: "warning",
      message: `No canonical developer matches "${project.developer_name_raw}"; the raw value was preserved for later enrichment.`,
      payload: { raw_name: project.developer_name_raw },
    },
    {
      entity: "location",
      code: "location_unresolved",
      severity: "warning",
      message: `No canonical location matches "${project.location_name_raw}"; the raw value was preserved for later enrichment.`,
      payload: { raw_name: project.location_name_raw },
    },
    {
      entity: "project",
      code: "authoritative_price_list_unresolved",
      severity: "warning",
      message:
        "No authoritative Rainpalm price list has been selected. Four conflicting price documents exist; the document cited by the original package is absent; the only variant with a qualified extraction chain supports 9 of the 14 previously asserted prices; and a fourth variant carries an entirely different 21-unit schedule. No unit price was imported. Prices must not be averaged, merged, or selected by filename.",
      payload: {
        cited_source_file_absent: RAINPALM_CITED_BUT_ABSENT,
        conflicting_documents: priceDocuments,
        owner_decision_required: [
          "Nominate the authoritative price list, ideally with its issue date stated inside the document.",
          "Rule on whether the 4_12_2025 variant supersedes the 14-price schedule, and state what 4_12_2025 denotes.",
          "Supply the absent cited document, or confirm in writing that 'Rainpalm - Price List new.pdf' is the same document under another name.",
          "Confirm D4's availability: Available or Reserved.",
          "Grant or withhold permission to publish unit-level prices from an in-house document.",
        ],
      },
    },
    {
      entity: "project",
      field: "source_file",
      code: "cited_source_file_absent",
      severity: "warning",
      message: `The verified intake inventory "${inventory.citation}" cites "${RAINPALM_CITED_BUT_ABSENT}" for every unit field — code, type, bedrooms, bathrooms, size and availability — and the retired package cited it for every price. This build proved the file is absent from every configured source root. The structural layer is therefore carried at "extracted" confidence against the intake artifact, not as document-backed developer material, and no price row was carried over. Project identity is unaffected: it resolves through "${facts.citation}" to the verified "${presentation.citation}".`,
      payload: {
        cited_file: RAINPALM_CITED_BUT_ABSENT,
        also_absent: RAINPALM_CURRENCY_CITED_BUT_ABSENT,
        affected_layer: "unit structure and availability",
        verified_intake_artifacts: [
          { file: facts.citation, sha256: facts.sha256, bytes: facts.bytes },
          { file: inventory.citation, sha256: inventory.sha256, bytes: inventory.bytes },
        ],
        identity_chain_resolves_to: {
          file: presentation.citation,
          sha256: presentation.sha256,
          bytes: presentation.bytes,
        },
      },
    },
    {
      entity: "unit",
      field: "availability_status",
      code: "availability_unverified",
      severity: "warning",
      message: `Availability was not imported. Every availability value in the verified intake inventory cites the absent "${RAINPALM_CITED_BUT_ABSENT}", so all ${units.length} units carry the schema default and that default must not be read as a verified availability state.`,
      payload: { units_affected: units.length },
    },
    {
      entity: "unit",
      field: "availability_status",
      code: "availability_conflict",
      severity: "warning",
      message: `Unit D4 is rendered ${d4Availability ?? "(unstated)"} by the verified intake inventory and Reserved by the one price document with a qualified extraction chain. The conflict is unresolved.`,
      payload: {
        unit_code: "D4",
        intake_inventory_value: d4Availability,
        intake_inventory_file: inventory.citation,
        document_value: "Reserved",
        document: SOURCES.rainpalmPrice042025.citation,
      },
    },
    {
      entity: "media",
      code: "media_not_ingested",
      severity: "info",
      message:
        "The Rainpalm dossier holds a master plan, a presentation, a payment-terms document, a legal/ownership document, a 22-file picture set and a 598 MB video. None was ingested: media rows require a hosted URL, and no Storage upload was performed by this task. The 598 MB video also exceeds the 300 MiB intake archive limit and must be split or deferred.",
    },
  ];

  return emit("rainpalm-villas", {
    schema_version: "1",
    mode: "create",
    project,
    units,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// 2. Garden of Eden (Park Residence) — Passport Light
// ---------------------------------------------------------------------------

function buildGardenOfEden() {
  const eng = requireSource("gardenOfEdenEng");
  const rus = requireSource("gardenOfEdenRus");

  const project = {
    slug: "garden-of-eden",
    name: "Garden of Eden (Park Residence)",
    developer_id: null,
    location_id: null,
    publish: false,
    location_name_raw: "Layan",
    location_area: "Layan",
    project_type: "Premium apart-hotel",
    field_provenance: {
      // Agency presentation, not developer material: never developer_provided,
      // never official_project_material, confidence below 1.
      name: agencyProvenance(`${eng.citation}#page=2`, "2026-01"),
      location_name_raw: agencyProvenance(`${eng.citation}#page=2`, "2026-01"),
      location_area: agencyProvenance(`${eng.citation}#page=2`, "2026-01"),
      project_type: agencyProvenance(`${eng.citation}#page=2`, "2026-01"),
    },
  };

  const warnings = [
    {
      entity: "developer",
      code: "developer_unresolved",
      severity: "warning",
      message:
        "No developer is named anywhere in the available source. Both decks are agency investment presentations produced by Sunthai Property, not developer material, so no raw developer name could be preserved either.",
      payload: { source_documents: [eng.citation, rus.citation] },
    },
    {
      entity: "location",
      code: "location_unresolved",
      severity: "warning",
      message:
        'No canonical location matches "Layan"; the raw value was preserved for later enrichment.',
      payload: { raw_name: "Layan" },
    },
    {
      entity: "project",
      code: "country_missing",
      severity: "warning",
      message:
        "No country is stated. The deck references Phuket International Airport and Laguna Phuket, but neither names the country, so currency cannot be inferred.",
    },
    {
      entity: "project",
      field: "latitude",
      code: "coordinates_missing",
      severity: "info",
      message: "No coordinates are stated in the source; latitude/longitude remain NULL.",
    },
    {
      entity: "project",
      field: "construction_status",
      code: "construction_status_missing",
      severity: "info",
      message:
        "No construction status is stated. The deck states a completion quarter only, which is recorded separately.",
    },
    {
      entity: "project",
      field: "completion_date",
      code: "completion_quarter_only",
      severity: "info",
      message:
        'The source states completion as "Q4-2027". A quarter is not a date, so completion_date remains NULL rather than being resolved to an invented day.',
      payload: { stated: "Q4-2027", source_ref: `${eng.citation}#page=2` },
    },
    {
      entity: "building",
      code: "building_inventory_missing",
      severity: "warning",
      message:
        'The source states "Buildings: 6" but gives no building identifiers, names, floor counts or unit counts. No building row was created, because inventing six codes would fabricate structure.',
      payload: { stated_count: 6, source_ref: `${eng.citation}#page=2` },
    },
    {
      entity: "unit",
      code: "unit_types_missing",
      severity: "warning",
      message:
        "No unit schedule, unit type list or unit inventory appears in the source. No unit row was created.",
    },
    {
      entity: "price",
      code: "price_list_missing",
      severity: "warning",
      message:
        "No developer price list exists for this project in any inspected source root. No price row was created.",
    },
    {
      entity: "price",
      code: "investment_projections_not_prices",
      severity: "warning",
      message:
        "Pages 4 to 6 of the deck carry a five-year investment model with entry/exit figures, discount tiers, ROI percentages and a stated rental return. These are agency projections, not developer prices or yields. They were deliberately not ingested and must never be rendered as a price, a price range or a yield promise.",
      payload: { source_ref: `${eng.citation}#pages=4-6` },
    },
    {
      entity: "project",
      code: "stated_facts_not_modelled",
      severity: "info",
      message:
        "Source-stated facts with no column in the current schema were preserved here rather than discarded or forced into an unrelated field.",
      payload: {
        distance_to_beach: "300 m",
        total_area: "over 122 000 sqm",
        territory_landscaped_share: "70% parks, lakes, gardens and swimming pools",
        management: "A professional management company is in place",
        source_ref: `${eng.citation}#pages=2-3`,
      },
    },
    {
      entity: "media",
      code: "media_not_ingested",
      severity: "info",
      message:
        "Both decks contain embedded imagery only, with no standalone media assets. No media row was created and no asset was uploaded or made public.",
      payload: {
        documents: [
          { file: eng.citation, sha256: eng.sha256, bytes: eng.bytes, language: "English" },
          { file: rus.citation, sha256: rus.sha256, bytes: rus.bytes, language: "Russian" },
        ],
      },
    },
    {
      entity: "project",
      field: "source_date",
      code: "source_date_recorded",
      severity: "info",
      message:
        'The English deck states "January 2026" on its title page. That in-document statement is the source date; no file timestamp was used.',
      payload: { source_date: "2026-01", source_ref: `${eng.citation}#page=1` },
    },
  ];

  return emit("garden-of-eden", {
    schema_version: "1",
    mode: "create",
    project,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// 3. The Title Sierra — Passport Light plus the 2026-05-15 unit price list
// ---------------------------------------------------------------------------

const SIERRA_ROW =
  /^([A-Z])\s+(\d+)\s+(Available|Reserved|Sold|Booked)\s+(SB[A-Z]\d+)\s+(\S+)\s+(.+?)\s+([\d.]+)\s+([\d,]+)\s+([\d,]+\.\d{2})\s*$/;

function parseSierraRows(text) {
  const rows = [];
  const unresolved = [];
  text.split("\f").forEach((pageText, pageIndex) => {
    for (const line of pageText.split(/\r?\n/)) {
      if (!/SB[A-Z]\d+/.test(line)) continue;
      const match = SIERRA_ROW.exec(line.trimEnd());
      if (!match) {
        unresolved.push({ page: pageIndex + 1, line });
        continue;
      }
      rows.push({
        page: pageIndex + 1,
        tower: match[1],
        floor: Number(match[2]),
        status: match[3],
        room: match[4],
        typeCode: match[5],
        roomType: match[6].trim().replace(/\s+/g, " "),
        areaSqm: Number(match[7]),
        pricePerSqm: Number(match[8].replace(/,/g, "")),
        sellingPrice: Number(match[9].replace(/,/g, "")),
      });
    }
  });
  return { rows, unresolved };
}

function buildSierra() {
  const priceList = requireSource("sierraPriceList");
  const masterPlan = requireSource("sierraMasterPlan");

  const { rows, unresolved } = parseSierraRows(pdfToTableText(priceList.path));
  if (unresolved.length) {
    throw new Error(
      `Sierra price list produced ${unresolved.length} unresolved row(s); refusing to guess. First: ${JSON.stringify(unresolved[0])}`,
    );
  }
  if (!rows.length) throw new Error("Sierra price list produced no rows.");

  // Integrity gates. Each failure is a refusal, never a repair.
  const codes = rows.map((row) => row.room);
  if (new Set(codes).size !== codes.length) throw new Error("Duplicate Sierra room numbers.");
  for (const row of rows) {
    if (row.room[2] !== row.tower) {
      throw new Error(`Tower/room-number disagreement at ${row.room}.`);
    }
    const digits = row.room.slice(3);
    if (Number(digits.slice(0, digits.length - 2)) !== row.floor) {
      throw new Error(`Floor/room-number disagreement at ${row.room}.`);
    }
    if (Math.abs(row.pricePerSqm * row.areaSqm - row.sellingPrice) > row.sellingPrice * 0.005) {
      throw new Error(`Price/sqm times area disagrees with selling price at ${row.room}.`);
    }
    if (!Number.isInteger(row.sellingPrice)) {
      throw new Error(`Non-integer selling price at ${row.room}.`);
    }
  }

  const sorted = [...rows].sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : 0));

  // Only the code is source-backed: the Tower column contains the letters A and
  // C. It does not contain building names. "Tower A" would be a display label
  // this build invented, so no `name` is emitted. The RPC supplies its own
  // fallback label at insert time, which is a database default rather than a
  // fact asserted here.
  const towers = [...new Set(sorted.map((row) => row.tower))].sort();
  const buildings = towers.map((tower) => ({
    building_code: tower,
    metadata: {
      field_provenance: {
        building_code: provenance(`${priceList.citation}#column=Tower`),
      },
    },
  }));

  // Bedrooms are read from the stated Room Type ("1 BEDROOM ..." / "2 BEDROOM ...").
  // Bathrooms are not stated anywhere in the document and stay absent.
  const bedroomsOf = (roomType) => {
    const match = /^(\d+)\s+BEDROOM\b/.exec(roomType);
    if (!match) throw new Error(`Unreadable bedroom count in room type "${roomType}".`);
    return Number(match[1]);
  };

  const units = sorted.map((row) => ({
    unit_code: row.room,
    building_code: row.tower,
    unit_type: row.roomType,
    bedrooms: bedroomsOf(row.roomType),
    size_sqm: row.areaSqm,
    floor: row.floor,
    availability_status: row.status.toLowerCase(),
    metadata: {
      source_type_code: row.typeCode,
      field_provenance: {
        unit_type: provenance(`${priceList.citation}#page=${row.page}`),
        bedrooms: provenance(`${priceList.citation}#page=${row.page}`, "extracted"),
        size_sqm: provenance(`${priceList.citation}#page=${row.page}`),
        floor: provenance(`${priceList.citation}#page=${row.page}`),
        availability_status: provenance(`${priceList.citation}#page=${row.page}`),
      },
    },
  }));

  const currencyDecision = {
    value: "THB",
    status: "source_verified",
    confidence: "medium",
    priceEvidence: [
      {
        value: "THB",
        status: "source_verified",
        confidence: "medium",
        sourceFile: priceList.citation,
        sourcePage: 4,
        context: "additional-cost block: sinking fund 800 THB/sqm and common fee 80 THB/sqm/month",
      },
    ],
    reviewFindings: [
      {
        code: "currency_not_stated_on_price_rows",
        message:
          "The Selling Price column carries no currency symbol or code. THB is stated elsewhere in the same document, for fees rather than for the selling price, so confidence is medium rather than high.",
      },
    ],
  };

  const prices = sorted.map((row) => ({
    unit_code: row.room,
    price: row.sellingPrice,
    currency: "THB",
    price_source: "developer_price_list",
    source_file: priceList.citation,
    source_page: row.page,
    price_list_date: "2026-05-15",
    metadata: {
      source_price_per_sqm: row.pricePerSqm,
      currency_decision: currencyDecision,
      field_provenance: {
        price: { status: "extracted" },
        // Matches currency_decision.status above: THB is written in the
        // document, just not on the price row, hence medium confidence.
        currency: { status: "source_verified" },
      },
    },
  }));

  // Source self-inconsistency: one Type (No.) code maps to two different Room
  // Type strings. Both are stored verbatim; neither is normalised away.
  const codeToTypes = new Map();
  for (const row of sorted) {
    if (!codeToTypes.has(row.typeCode)) codeToTypes.set(row.typeCode, new Set());
    codeToTypes.get(row.typeCode).add(row.roomType);
  }
  const inconsistentTypeCodes = [...codeToTypes.entries()]
    .filter(([, types]) => types.size > 1)
    .map(([code, types]) => ({ type_code: code, room_types: [...types].sort() }));

  const warnings = [
    {
      entity: "developer",
      code: "developer_unresolved",
      severity: "warning",
      message:
        "The price list names no legal entity. The project carries The Title brand prefix, but resolving that to a company would be inference, so no developer name was asserted — not even as a raw value.",
    },
    {
      entity: "location",
      code: "location_missing",
      severity: "warning",
      message:
        "No location is stated in any text-extractable Sierra source. The master plan that would carry it is image-only.",
      payload: { master_plan: masterPlan.citation, master_plan_sha256: masterPlan.sha256 },
    },
    {
      entity: "project",
      code: "country_missing",
      severity: "warning",
      message:
        "No country is stated. THB appears in the additional-cost block, but the document never names a country.",
    },
    {
      entity: "project",
      field: "project_type",
      code: "project_type_missing",
      severity: "warning",
      message:
        "No property type is stated. The document exhibits a tower/floor/room structure with one- and two-bedroom types, a sinking fund and a monthly common fee, but it never names the type, so project_type stays NULL rather than being inferred.",
      payload: { observed_structure: "tower / floor / room number, sinking fund, common fee" },
    },
    {
      entity: "project",
      field: "latitude",
      code: "coordinates_missing",
      severity: "info",
      message: "No coordinates are stated in the source; latitude/longitude remain NULL.",
    },
    {
      entity: "project",
      field: "construction_status",
      code: "construction_status_missing",
      severity: "info",
      message: "No construction status or completion date is stated in the available source.",
    },
    {
      entity: "unit",
      field: "bathrooms",
      code: "bathrooms_missing",
      severity: "info",
      message: "The price list carries no bathroom count for any unit; bathrooms remain NULL.",
      payload: { units_affected: units.length },
    },
    {
      entity: "building",
      code: "building_inventory_partial",
      severity: "info",
      message:
        "Building rows were derived from the Tower column of the price list, so they cover only towers with listed units. The source supplies the tower codes and nothing else: no building name, floor count or unit count is stated, and none was derived — a price list enumerates offered units rather than a building's full inventory, and a label such as \"Tower A\" would be this pipeline's invention rather than a source fact.",
      payload: {
        towers: towers,
        listed_units_per_tower: Object.fromEntries(
          towers.map((tower) => [tower, sorted.filter((row) => row.tower === tower).length]),
        ),
      },
    },
    {
      entity: "unit",
      field: "unit_type",
      code: "unit_type_code_inconsistent",
      severity: "warning",
      message:
        "The source maps one Type (No.) code to more than one Room Type string. Both columns are stored verbatim — Room Type as unit_type, Type (No.) in unit metadata — and neither was normalised.",
      payload: { inconsistent: inconsistentTypeCodes },
    },
    {
      entity: "price",
      field: "currency",
      code: "price_currency_document_level_only",
      severity: "info",
      message:
        "THB is stated in the document's additional-cost block, not on the price rows. Currency is recorded as THB at medium confidence with that evidence attached.",
      payload: { source_ref: `${priceList.citation}#page=4` },
    },
    {
      entity: "project",
      code: "internal_use_only_source",
      severity: "warning",
      message:
        'The price list is stamped "(Internal Use Only)" on every page. The data may be held in this internal draft, but unit-level prices and the document itself must not become anonymously public, and no publication permission is implied by this import.',
      payload: { source_ref: `${priceList.citation}#page=1`, marking: "(Internal Use Only)" },
    },
    {
      entity: "project",
      code: "brochure_missing",
      severity: "warning",
      message: "No brochure or presentation exists for this project in any inspected source root.",
    },
    {
      entity: "media",
      code: "media_not_ingested",
      severity: "info",
      message:
        "The master plan is image-only and was not OCR'd; no media row was created and no asset was uploaded or made public.",
      payload: {
        documents: [
          {
            file: priceList.citation,
            sha256: priceList.sha256,
            bytes: priceList.bytes,
            marking: "(Internal Use Only)",
          },
          {
            file: masterPlan.citation,
            sha256: masterPlan.sha256,
            bytes: masterPlan.bytes,
            note: "image-only, zero extractable characters",
          },
        ],
      },
    },
    {
      entity: "project",
      field: "source_date",
      code: "source_date_recorded",
      severity: "info",
      message:
        'The price list states "Updated : 15.05.26" in its page header. That in-document statement is the source date; no file timestamp was used.',
      payload: { source_date: "2026-05-15", source_ref: `${priceList.citation}#page=1` },
    },
  ];

  const project = {
    slug: "the-title-sierra",
    name: "The Title Sierra",
    developer_id: null,
    location_id: null,
    publish: false,
    field_provenance: {
      name: provenance(`${priceList.citation}#page=1`),
    },
  };

  return emit("the-title-sierra", {
    schema_version: "1",
    mode: "create",
    project,
    buildings,
    units,
    prices,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// Regression assertions — run on every build and every `--check`.
// ---------------------------------------------------------------------------

/** Every `field_provenance` entry anywhere in a payload, with a readable path. */
function collectProvenance(node, path = "", found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectProvenance(item, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (key === "field_provenance" && value && typeof value === "object") {
      for (const [field, entry] of Object.entries(value)) {
        found.push({ path: `${next}.${field}`, entry });
      }
      continue;
    }
    collectProvenance(value, next, found);
  }
  return found;
}

function auditGardenOfEden(payload) {
  const entries = collectProvenance(payload);
  const offending = entries.filter(
    ({ entry }) =>
      entry?.status === "developer_provided" ||
      entry?.status === "official_source" ||
      entry?.source_type === "official_project_material" ||
      entry?.source_type === "official_project_price_list",
  );
  if (offending.length) {
    throw new Error(
      `garden_provenance_violation: the Garden of Eden sources are agency investment presentations, ` +
        `so no field may claim developer or official provenance. Offending: ` +
        offending.map((item) => item.path).join(", "),
    );
  }
  const overconfident = entries.filter(({ entry }) => (entry?.confidence ?? 0) >= 1);
  if (overconfident.length) {
    throw new Error(
      `garden_provenance_violation: a secondary source cannot carry confidence 1. Offending: ` +
        overconfident.map((item) => item.path).join(", "),
    );
  }
  if (!entries.length) {
    throw new Error("garden_provenance_violation: no field provenance was emitted at all.");
  }
  console.log(
    `AUDIT garden-of-eden: ${entries.length} provenance entries, none developer_provided or official_project_material`,
  );
}

function auditSierra(payload) {
  const named = (payload.buildings ?? []).filter((building) => "name" in building);
  if (named.length) {
    throw new Error(
      `sierra_derived_name_violation: building name is not source-backed. Offending: ` +
        named.map((building) => building.building_code).join(", "),
    );
  }
  console.log(
    `AUDIT the-title-sierra: ${(payload.buildings ?? []).length} buildings, code-only, no derived names`,
  );
}

function auditRainpalm(payload) {
  if ((payload.prices ?? []).length) {
    throw new Error("rainpalm_price_violation: the structural draft must carry zero prices.");
  }
  const withAvailability = (payload.units ?? []).filter((unit) => "availability_status" in unit);
  if (withAvailability.length) {
    throw new Error(
      `rainpalm_availability_violation: availability must not be imported. Offending: ` +
        withAvailability.map((unit) => unit.unit_code).join(", "),
    );
  }
  const missingProvenance = (payload.units ?? []).filter(
    (unit) => !unit.metadata?.field_provenance,
  );
  if (missingProvenance.length) {
    throw new Error(
      `rainpalm_provenance_missing: every retained unit field needs provenance. Offending: ` +
        missingProvenance.map((unit) => unit.unit_code).join(", "),
    );
  }
  const codes = new Set((payload.warnings ?? []).map((warning) => warning.code));
  for (const required of [
    "authoritative_price_list_unresolved",
    "cited_source_file_absent",
    "availability_conflict",
  ]) {
    if (!codes.has(required)) {
      throw new Error(`rainpalm_warning_missing: ${required}`);
    }
  }
  console.log(
    `AUDIT rainpalm-villas: 0 prices, no availability, ${(payload.units ?? []).length} units with field provenance`,
  );
}

function auditDraftOnly(slug, payload) {
  if (payload.project.publish !== false || payload.mode !== "create") {
    throw new Error(`draft_violation: ${slug} must be mode=create with publish=false.`);
  }
}

// ---------------------------------------------------------------------------

const built = {
  "rainpalm-villas": buildRainpalm(),
  "garden-of-eden": buildGardenOfEden(),
  "the-title-sierra": buildSierra(),
};

for (const [slug, payload] of Object.entries(built)) auditDraftOnly(slug, payload);
auditRainpalm(built["rainpalm-villas"]);
auditGardenOfEden(built["garden-of-eden"]);
auditSierra(built["the-title-sierra"]);
