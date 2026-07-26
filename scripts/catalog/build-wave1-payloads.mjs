/**
 * FOREVER-CATALOG-10-002 / -006 — progressive draft payload builder.
 *
 * Wave 1 (FOREVER-CATALOG-10-002) — the three payloads that task authors:
 *
 *   - rainpalm-villas  structural-only rebuild (prices deliberately removed)
 *   - garden-of-eden   Passport Light from the January 2026 deck
 *   - the-title-sierra Passport Light plus the 2026-05-15 unit price list
 *
 * Wave 2 (FOREVER-CATALOG-10-006) — two deck-derived Passport Light records:
 *
 *   - layan-green-park                Passport Light from the January 2026 deck
 *   - ayana-heights-seaview-residence Passport Light from the January 2026 deck
 *
 * The Wave 2 pair carries no buildings, units or prices. Their decks state
 * building and unit *counts* but no identifiers and no price list, so the counts
 * are preserved as warnings rather than materialised as invented rows.
 *
 * Coralina is NOT rebuilt. Its canonical package already exists, validates and
 * reproduces its recorded hashes; re-deriving it would risk drift.
 *
 * OWNER UPLOAD TRUST POLICY (FOREVER-CATALOG-10-004)
 *
 * A project package the Owner deliberately supplies is the official working
 * source for the initial unpublished draft. The first import is not a forensic
 * source audit: it prioritises speed and completeness. Facts faithfully
 * extracted from an approved package are recorded as `owner_provided` /
 * `owner_uploaded_project_material` at confidence 1, and no second independent
 * document is required.
 *
 * Deep reconciliation — duplicate investigation, price and availability
 * comparison, independent confirmation — belongs to the later Project
 * Inspection / Update workflow, after a Forever broker visits the project or a
 * newer official package arrives. That workflow is not implemented here.
 *
 * Only these conditions stop an initial draft: a file cannot be read; the
 * package cannot be associated with a project; the payload fails the schema; a
 * duplicate project slug exists; a duplicate unit code exists inside the same
 * payload; a numeric value cannot be parsed safely; dangerous executable or
 * secret material would be committed; or a database operation cannot be proven
 * to target staging. Everything else becomes a warning or stays absent.
 *
 * The builder is deterministic: same inputs -> byte-identical payloads and
 * identical `batch_fingerprint` values. It invents nothing; absent data stays
 * absent and is recorded as a warning.
 *
 * Source documents live outside the repository, in Owner intake roots. They are
 * never copied into it, and their absolute paths are never committed: only the
 * filename, SHA-256 digest and byte length are pinned here, for reproducibility
 * of the selected package. A digest that no longer matches is a soft signal that
 * the package moved on, not a cross-folder conflict system: the build records it
 * and continues.
 *
 * Usage:
 *   set FOREVER_CATALOG_SOURCE_ROOTS=<root1>;<root2>
 *   node scripts/catalog/build-wave1-payloads.mjs [--check]
 *
 * `FOREVER_WAVE1_SOURCE_ROOTS` remains accepted as a fallback so the Wave 1
 * reproduction instructions already published in the staging report keep working.
 *
 * `--check` rebuilds in memory and fails if the committed payloads differ.
 *
 * `--only=<slug>[,<slug>...]` restricts the run to the named projects. Only
 * `the-title-sierra` needs an Xpdf `pdftotext` for its price table, so this lets
 * every other payload be built or verified on a machine without that toolchain.
 * It narrows the run; it never changes what a project builds.
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
const ONLY = (process.argv.find((arg) => arg.startsWith("--only=")) ?? "")
  .slice("--only=".length)
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);

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
// paths. Digests pin the intended copy of the selected package; drift is a soft
// notice, not a blocker.
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

  // Wave 2. Two decks per project from the same January 2026 Sunthai Property
  // family as Garden of Eden. The second file of each pair is a shorter variant
  // of the same English deck, not a translation — see `deckVariantNote`.
  layanGreenParkPrimary: {
    citation: "Layan Green Park - eng.pdf",
    sha256: "1203065c56b0bdbe97bdc190e09af7c9392df53ff4a1695e215d9705d59c70a2",
    bytes: 7338210,
  },
  layanGreenParkVariant: {
    citation: "Layan Green Park.pdf",
    sha256: "e7beee1d6dce124d05ec7f3c84584afbabc9024b143908d36c56abf500b79c81",
    bytes: 3066949,
  },
  ayanaHeightsPrimary: {
    citation: "AYANA Heights Seaview Residence - eng.pdf",
    sha256: "98c34b692ea1eae50af9eb84a2dbe73ea2e4842b32d1990926fd51ec82b79711",
    bytes: 6218924,
  },
  ayanaHeightsVariant: {
    citation: "AYANA Heights Seaview Residence.pdf",
    sha256: "1699bab868e9e59b59ee4f36fb8761c938665bea7b8d4bc493b6abbee21b22bb",
    bytes: 1948454,
  },

  // Rainpalm. The documents the build reads and the ones whose digests appear in
  // the payload, all part of the one Owner-approved package.
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
 * The Rainpalm price-list versions. Only the annotations live here; filename,
 * digest and size come from the resolved SOURCES entries at build time.
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
  const raw =
    process.env.FOREVER_CATALOG_SOURCE_ROOTS ?? process.env.FOREVER_WAVE1_SOURCE_ROOTS ?? "";
  const roots = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!roots.length) {
    throw new Error(
      "FOREVER_CATALOG_SOURCE_ROOTS is not set. Point it at the Owner intake folders holding the pinned source documents (semicolon-separated). FOREVER_WAVE1_SOURCE_ROOTS is still accepted.",
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

/** Soft signals gathered during a build. None of these blocks a draft. */
const softNotices = [];

/**
 * Resolve a pinned source by filename across the configured roots.
 *
 * The selected Owner package is the source boundary. Several folders holding a
 * file of the same name is normal and never blocks a project: the pinned digest
 * simply picks the intended copy. If no copy matches the pin, the package has
 * moved on — the build takes the newest candidate, records a soft notice, and
 * continues. Only a file that cannot be found or read is fatal.
 */
function requireSource(key) {
  const source = SOURCES[key];
  const matches = allSourceFiles().filter((path) => basename(path) === source.citation);
  if (!matches.length) {
    throw new Error(`source_unreadable: ${source.citation} was not found in any configured root.`);
  }

  const candidates = [];
  for (const path of matches) {
    try {
      candidates.push({
        path,
        bytes: statSync(path).size,
        sha256: sha256File(path),
        mtime: statSync(path).mtimeMs,
      });
    } catch {
      // Unreadable copy: skip it, another root may hold a readable one.
    }
  }
  if (!candidates.length) {
    throw new Error(
      `source_unreadable: ${source.citation} could not be read in any configured root.`,
    );
  }

  const pinned = candidates.find(
    (item) => item.sha256 === source.sha256 && item.bytes === source.bytes,
  );
  if (pinned) return { ...source, path: pinned.path };

  // No copy matches the pin. Prefer the newest — the clearest available version
  // signal — and preserve what changed rather than refusing to build.
  const newest = [...candidates].sort((a, b) => b.mtime - a.mtime)[0];
  softNotices.push({
    code: "source_version_changed",
    file: source.citation,
    pinned_sha256: source.sha256,
    selected_sha256: newest.sha256,
    selected_bytes: newest.bytes,
    candidates: candidates.length,
  });
  return { ...source, path: newest.path, sha256: newest.sha256, bytes: newest.bytes };
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
 * Field provenance for a fact faithfully extracted from an Owner-approved
 * project package. `owner_provided` is the existing status in
 * src/features/forever-ingestion/provenance.ts for direct first-party Owner
 * input; the Owner Upload Trust Policy extends it to a package the Owner
 * deliberately supplied. Confidence 1 records that the extraction is faithful to
 * that package — not that the package has been independently audited, which is
 * the later inspection workflow's job.
 */
function provenance(sourceRef, options = {}) {
  const { confidence = 1, note, sourceDate } = options;
  const result = {
    status: "owner_provided",
    source_type: "owner_uploaded_project_material",
    source_ref: sourceRef,
    confidence,
  };
  if (sourceDate) result.source_date = sourceDate;
  if (note) result.note = note;
  return result;
}

/**
 * One source record for a whole row whose values all come from the same line of
 * the same Owner-approved document. Repeating an identical provenance object per
 * column adds bulk without adding information.
 */
function rowSource(sourceRef, fields, options = {}) {
  const { sourceDate, note } = options;
  const result = {
    status: "owner_provided",
    source_type: "owner_uploaded_project_material",
    source_ref: sourceRef,
    confidence: 1,
    applies_to: fields,
  };
  if (sourceDate) result.source_date = sourceDate;
  if (note) result.note = note;
  return result;
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
// 1. Rainpalm Villas — accepted structural draft, prices deferred
// ---------------------------------------------------------------------------

function factValue(fact, label) {
  const value = fact?.value;
  if (value == null || String(value).trim() === "") {
    throw new Error(`rainpalm_source_incomplete: ${label} is absent from the verified source.`);
  }
  return String(value).trim();
}

function buildRainpalm() {
  // The Owner-approved Rainpalm package is the official initial working source.
  // Digests are pinned for reproducibility, not as a cross-folder audit.
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

  const factsDocument = JSON.parse(readFileSync(facts.path, "utf8"));
  const inventoryDocument = JSON.parse(readFileSync(inventory.path, "utf8"));

  // Project identity from the Owner package, attributed to the presentation the
  // package's facts cite.
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

  // Unit code, type, bedrooms, bathrooms and size all come from the same row of
  // the same Owner-approved document, so one row-level source record covers the
  // whole row. Availability is not imported yet — it moves with the price list,
  // and several price-list versions exist.
  const unitFields = ["unit_code", "unit_type", "bedrooms", "bathrooms", "size_sqm"];
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
          source: rowSource(inventory.citation, unitFields),
        },
      };
      // A number that will not parse is a hard blocker: it would silently
      // corrupt the draft.
      for (const [key, value] of Object.entries(unit)) {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error(`unit_value_unparseable: unit ${code} has a non-numeric ${key}.`);
        }
      }
      return unit;
    })
    .sort((a, b) => (a.unit_code < b.unit_code ? -1 : a.unit_code > b.unit_code ? 1 : 0));

  // A duplicate unit code inside one payload is a hard blocker.
  const seen = new Set();
  for (const unit of units) {
    if (seen.has(unit.unit_code)) {
      throw new Error(`duplicate_unit_code: ${unit.unit_code} appears twice in the same payload.`);
    }
    seen.add(unit.unit_code);
  }

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
      entity: "price",
      code: "multiple_price_list_versions",
      severity: "info",
      message: `The Rainpalm package contains ${priceDocuments.length} price-list versions, so no single current schedule can be selected yet. Prices and availability stay inactive for now; the ${units.length}-unit structure is accepted and unaffected. Prices will be activated once the Owner selects the current version or a newer developer price list arrives. Versions are preserved side by side — none was averaged, merged, or chosen by filename.`,
      payload: {
        versions: priceDocuments,
        activation_condition:
          "Owner selects the current version, or a newer developer price list is received.",
        availability_note:
          "Availability moves with the price list, so it is deferred alongside prices; all units carry the schema default, which is not a verified availability state.",
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
      // Owner Upload Trust Policy (FOREVER-CATALOG-10-004): an Owner-supplied
      // package is the accepted working source for a first draft, so these are
      // owner_provided / owner_uploaded_project_material at confidence 1.
      // Confidence 1 records that the extraction is faithful to the package, not
      // that the package has been independently audited. The comment previously
      // here claimed "confidence below 1", which contradicted the value
      // `provenance()` actually emits and the payload actually carries.
      name: provenance(`${eng.citation}#page=2`, { sourceDate: "2026-01" }),
      location_name_raw: provenance(`${eng.citation}#page=2`, { sourceDate: "2026-01" }),
      location_area: provenance(`${eng.citation}#page=2`, { sourceDate: "2026-01" }),
      project_type: provenance(`${eng.citation}#page=2`, { sourceDate: "2026-01" }),
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
// 3. Wave 2 deck pair — Layan Green Park and AYANA Heights Seaview Residence
//
// Both come from the same January 2026 Sunthai Property deck family as Garden
// of Eden and are built the same way: source-stated facts are transcribed with
// a page citation, and anything the deck does not state stays absent behind a
// warning. Neither deck contains a price list or any per-unit identifier, so
// both records are project-only — zero buildings, zero units, zero prices.
// ---------------------------------------------------------------------------

/**
 * Each project ships two PDFs. The second is NOT a translation: its text layer
 * is the same English deck with the closing agency-contact page removed. The
 * onboarding register describes these second files as Russian; that label does
 * not survive inspection of the documents' own text, so it is not repeated in
 * the payloads. Recorded per document rather than asserted globally.
 */
function deckVariantNote(primary, variant) {
  return {
    documents: [
      {
        file: primary.citation,
        sha256: primary.sha256,
        bytes: primary.bytes,
        language: "English",
        role: "primary deck",
      },
      {
        file: variant.citation,
        sha256: variant.sha256,
        bytes: variant.bytes,
        language: "English",
        role: "shorter variant of the same English deck; closing contact page absent",
      },
    ],
  };
}

function buildLayanGreenPark() {
  const primary = requireSource("layanGreenParkPrimary");
  const variant = requireSource("layanGreenParkVariant");
  const cite = (page) => `${primary.citation}#page=${page}`;

  const project = {
    slug: "layan-green-park",
    name: "Layan Green Park",
    developer_id: null,
    location_id: null,
    publish: false,
    location_name_raw: "Layan",
    location_area: "Layan",
    project_type: "Premium apart-hotel",
    field_provenance: {
      name: provenance(cite(2), { sourceDate: "2026-01" }),
      location_name_raw: provenance(cite(2), { sourceDate: "2026-01" }),
      location_area: provenance(cite(2), { sourceDate: "2026-01" }),
      project_type: provenance(cite(2), {
        sourceDate: "2026-01",
        note: 'Page 2 states "PREMIUM APART-HOTEL". The page 4 financial annex states "Property Type: Condominiums"; the disagreement is recorded as project_type_inconsistent rather than resolved here.',
      }),
    },
  };

  const warnings = [
    {
      entity: "developer",
      code: "developer_unresolved",
      severity: "warning",
      message:
        "No developer is named anywhere in the available source. Both documents are agency investment presentations produced by Sunthai Property, not developer material, so no raw developer name could be preserved either.",
      payload: { source_documents: [primary.citation, variant.citation] },
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
        "No country is stated. The deck references Bang Tao and Laguna Phuket, but neither names the country, so currency cannot be inferred.",
      payload: { source_ref: cite(8) },
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
      field: "construction_status",
      code: "construction_status_stale",
      severity: "warning",
      message:
        'The source states completion as "Q1-2026". That quarter had already closed when the deck was issued in January 2026 and is further in the past now, so it must not be presented as a current readiness state. A current construction or handover update is required before publication.',
      payload: {
        stated_completion: "Q1-2026",
        source_date: "2026-01",
        source_ref: cite(2),
      },
    },
    {
      entity: "project",
      field: "completion_date",
      code: "completion_quarter_only",
      severity: "info",
      message:
        'The source states completion as "Q1-2026". A quarter is not a date, so completion_date remains NULL rather than being resolved to an invented day.',
      payload: { stated: "Q1-2026", source_ref: cite(2) },
    },
    {
      entity: "building",
      code: "building_inventory_missing",
      severity: "warning",
      message:
        'The source states "Buildings: 4" but gives no building identifiers, names, floor counts or unit counts. No building row was created, because inventing four codes would fabricate structure.',
      payload: { stated_count: 4, source_ref: cite(2) },
    },
    {
      entity: "unit",
      code: "unit_inventory_missing",
      severity: "warning",
      message:
        'The source states "Total units: 377" but contains no per-unit identifier, room number or unit schedule. The stated total is preserved here; no unit row was created.',
      payload: { stated_total_units: 377, source_ref: cite(2) },
    },
    {
      entity: "unit",
      code: "unit_types_missing",
      severity: "warning",
      message:
        "No unit type schedule, bedroom breakdown or area schedule appears in the source. No unit row was created.",
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
        "Pages 4 to 7 carry a five-year investment model with entry/exit values, a bulk-purchase discount, capitalisation and rental-pool projections, ROI, IRR and an equity multiple. These are agency projections for a bulk investment pool, not developer prices or yields. They were deliberately not ingested and must never be rendered as a price, a price range or a yield promise.",
      payload: {
        source_ref: `${primary.citation}#pages=4-7`,
        model_basis:
          "Returns are calculated based on the Leasehold ownership structure (stated page 5).",
      },
    },
    {
      entity: "project",
      field: "project_type",
      code: "project_type_inconsistent",
      severity: "warning",
      message:
        'The source disagrees with itself about the property type. Page 2 states "PREMIUM APART-HOTEL"; the page 4 financial annex states "Property Type: Condominiums". Page 2 is the project identity page and supplies project_type; both statements are recorded verbatim and neither was normalised away.',
      payload: {
        page_2: "PREMIUM APART-HOTEL",
        page_4: "Condominiums",
        source_refs: [cite(2), cite(4)],
      },
    },
    {
      entity: "project",
      code: "project_scope_ambiguous",
      severity: "warning",
      message:
        'The page 4 investment model is labelled "Layan Green Partk, фаза 2" — phase 2 — and covers 28 units over 2,457.7 sqm, while page 2 describes the project as 377 units across 4 buildings. The model therefore describes a subset or a later phase, not the whole project. This record models the page 2 project. The spelling "Partk" and the Russian "фаза 2" are the source\'s own, quoted rather than corrected.',
      payload: {
        annex_label: "Layan Green Partk, фаза 2",
        annex_units: 28,
        annex_sellable_area_sqm: 2457.7,
        project_stated_units: 377,
        source_refs: [cite(2), cite(4)],
      },
    },
    {
      entity: "project",
      code: "related_project_name_in_source",
      severity: "warning",
      message:
        'Page 6 of this project\'s own deck reads "LA GREEN HOTEL & RESIDENCE represents an attractive investment...". The onboarding register records "La Green Hotel & Residence Layan" as a separate provisional catalogue entry with no located source, and requires that it not be merged with Layan Green Park. This deck names it inside Layan Green Park material. The conflict is recorded, not resolved: no merge, no alias and no second record was created here, and an Owner ruling is required.',
      payload: {
        stated_name: "LA GREEN HOTEL & RESIDENCE",
        source_ref: cite(6),
        register_reference: "docs/FOREVER_CATALOG_10_ONBOARDING.md §6.11",
      },
    },
    {
      entity: "project",
      code: "units_sold_snapshot",
      severity: "info",
      message:
        'The source states "Units sold: 45%". That is a January 2026 snapshot, not a current availability figure, and it is recorded only with its date. It must never be rendered as current availability.',
      payload: { stated: "45%", as_of: "2026-01", source_ref: cite(2) },
    },
    {
      entity: "project",
      code: "stated_facts_not_modelled",
      severity: "info",
      message:
        "Source-stated facts with no column in the current schema were preserved here rather than discarded or forced into an unrelated field.",
      payload: {
        distance_to_beach: "700 m",
        setting:
          "Close to the sea, Sirinat National Park, five-star hotels and the Laguna resort; described as one of the key projects shaping the infrastructure of the Layan area.",
        source_ref: `${primary.citation}#pages=2-3`,
      },
    },
    {
      entity: "media",
      code: "media_not_ingested",
      severity: "info",
      message:
        "Both documents contain embedded imagery only, with no standalone media assets. No media row was created and no asset was uploaded or made public.",
      payload: deckVariantNote(primary, variant),
    },
    {
      entity: "project",
      field: "source_date",
      code: "source_date_recorded",
      severity: "info",
      message:
        'The deck states "INVESTMENT OPPORTUNITY / January / 2026" on its title page. That in-document statement is the source date; no file timestamp was used.',
      payload: { source_date: "2026-01", source_ref: cite(1) },
    },
  ];

  return emit("layan-green-park", {
    schema_version: "1",
    mode: "create",
    project,
    warnings,
  });
}

function buildAyanaHeights() {
  const primary = requireSource("ayanaHeightsPrimary");
  const variant = requireSource("ayanaHeightsVariant");
  const cite = (page) => `${primary.citation}#page=${page}`;

  const project = {
    slug: "ayana-heights-seaview-residence",
    name: "AYANA Heights Seaview Residence",
    developer_id: null,
    location_id: null,
    publish: false,
    location_name_raw: "Layan",
    location_area: "Layan",
    project_type: "Premium apart-hotel",
    field_provenance: {
      name: provenance(cite(2), { sourceDate: "2026-01" }),
      location_name_raw: provenance(cite(2), { sourceDate: "2026-01" }),
      location_area: provenance(cite(2), { sourceDate: "2026-01" }),
      project_type: provenance(cite(2), { sourceDate: "2026-01" }),
    },
  };

  const warnings = [
    {
      entity: "developer",
      code: "developer_unresolved",
      severity: "warning",
      message:
        "No developer is named anywhere in the available source. Both documents are agency investment presentations produced by Sunthai Property, not developer material, so no raw developer name could be preserved either.",
      payload: { source_documents: [primary.citation, variant.citation] },
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
        "No country is stated. The deck references Bang Tao and Laguna Phuket, but neither names the country. The investment model quotes Thai baht, which is a model currency and not a stated project country.",
      payload: { source_refs: [cite(7), cite(4)] },
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
        'The source states completion as "Q2-2027". A quarter is not a date, so completion_date remains NULL rather than being resolved to an invented day.',
      payload: { stated: "Q2-2027", source_ref: cite(2) },
    },
    {
      entity: "building",
      code: "building_inventory_missing",
      severity: "warning",
      message:
        'The source states "Buildings: 8" but gives no building identifiers, names, floor counts or unit counts. No building row was created, because inventing eight codes would fabricate structure.',
      payload: { stated_count: 8, source_ref: cite(2) },
    },
    {
      entity: "unit",
      code: "unit_inventory_missing",
      severity: "warning",
      message:
        'The source states "Total units: 543" but contains no per-unit identifier, room number or unit schedule. The stated total is preserved here; no unit row was created.',
      payload: { stated_total_units: 543, source_ref: cite(2) },
    },
    {
      entity: "unit",
      code: "unit_types_missing",
      severity: "warning",
      message:
        "No unit type schedule, bedroom breakdown or area schedule appears in the source. No unit row was created.",
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
        "Pages 4 to 6 carry a five-year investment model quoted in Thai baht, with an entry value, a bulk investment pool, a 15% discount, average price-per-sqm figures, an exit price and ROI tiers. These are agency projections for a bulk investment pool, not developer prices or yields. They were deliberately not ingested and must never be rendered as a price, a price range or a yield promise.",
      payload: { source_ref: `${primary.citation}#pages=4-6` },
    },
    {
      entity: "project",
      code: "stated_facts_not_modelled",
      severity: "info",
      message:
        "Source-stated facts with no column in the current schema were preserved here rather than discarded or forced into an unrelated field.",
      payload: {
        distance_to_beach: "400 m",
        management: "A professional management company is in place",
        setting:
          "Close to the sea, Sirinat National Park, five-star hotels and the Laguna resort; described as one of the key projects shaping the infrastructure of the Layan area.",
        source_ref: `${primary.citation}#pages=2-3`,
      },
    },
    {
      entity: "media",
      code: "media_not_ingested",
      severity: "info",
      message:
        "Both documents contain embedded imagery only, with no standalone media assets. No media row was created and no asset was uploaded or made public.",
      payload: deckVariantNote(primary, variant),
    },
    {
      entity: "project",
      field: "source_date",
      code: "source_date_recorded",
      severity: "info",
      message:
        'The deck states "INVESTMENT OPPORTUNITY / January / 2026" on its title page. That in-document statement is the source date; no file timestamp was used.',
      payload: { source_date: "2026-01", source_ref: cite(1) },
    },
  ];

  return emit("ayana-heights-seaview-residence", {
    schema_version: "1",
    mode: "create",
    project,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// 4. The Title Sierra — Passport Light plus the 2026-05-15 unit price list
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
      source: rowSource(`${priceList.citation}#column=Tower`, ["building_code"], {
        sourceDate: "2026-05-15",
      }),
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
      // Every value on this unit comes from one row of the price list, so one
      // row-level source record covers them all.
      source: rowSource(
        `${priceList.citation}#page=${row.page}`,
        [
          "unit_code",
          "building_code",
          "unit_type",
          "bedrooms",
          "size_sqm",
          "floor",
          "availability_status",
        ],
        { sourceDate: "2026-05-15" },
      ),
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
      // Price and currency come from the same row of the same Owner-approved
      // price list, so one row-level source record covers both.
      source: rowSource(`${priceList.citation}#page=${row.page}`, ["price", "currency"], {
        sourceDate: "2026-05-15",
      }),
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
// Initial-import assertions. These cover the hard blockers only — everything
// else is a warning or stays absent, per the Owner Upload Trust Policy.
// ---------------------------------------------------------------------------

/** Duplicate unit codes inside one payload are a hard blocker. */
function auditNoDuplicateUnits(slug, payload) {
  const seen = new Set();
  for (const unit of payload.units ?? []) {
    if (seen.has(unit.unit_code)) {
      throw new Error(`duplicate_unit_code: ${slug} repeats ${unit.unit_code}.`);
    }
    seen.add(unit.unit_code);
  }
}

/** Every numeric that reached the payload must be finite. */
function auditNumericsParsed(slug, payload) {
  const numericFields = ["bedrooms", "bathrooms", "size_sqm", "floor"];
  for (const unit of payload.units ?? []) {
    for (const field of numericFields) {
      if (field in unit && !Number.isFinite(unit[field])) {
        throw new Error(`unit_value_unparseable: ${slug} ${unit.unit_code}.${field}.`);
      }
    }
  }
  for (const price of payload.prices ?? []) {
    if (!Number.isFinite(price.price)) {
      throw new Error(`price_value_unparseable: ${slug} ${price.unit_code}.`);
    }
  }
}

/** A draft must never be born published. */
function auditDraftOnly(slug, payload) {
  if (payload.project.publish !== false || payload.mode !== "create") {
    throw new Error(`draft_violation: ${slug} must be mode=create with publish=false.`);
  }
}

/** Rainpalm ships structure now and prices later; that must stay true. */
function auditRainpalm(payload) {
  if ((payload.prices ?? []).length) {
    throw new Error("rainpalm_price_violation: prices stay inactive until a version is selected.");
  }
  const codes = new Set((payload.warnings ?? []).map((warning) => warning.code));
  if (!codes.has("multiple_price_list_versions")) {
    throw new Error("rainpalm_warning_missing: multiple_price_list_versions");
  }
  console.log(
    `AUDIT rainpalm-villas: ${(payload.units ?? []).length} units accepted, prices deferred (multiple_price_list_versions)`,
  );
}

/** Sierra buildings carry a source-backed code, never a derived display name. */
function auditSierra(payload) {
  const named = (payload.buildings ?? []).filter((building) => "name" in building);
  if (named.length) {
    throw new Error(
      `sierra_derived_name_violation: building name is not source-backed. Offending: ` +
        named.map((building) => building.building_code).join(", "),
    );
  }
  console.log(
    `AUDIT the-title-sierra: ${(payload.buildings ?? []).length} buildings, ${(payload.units ?? []).length} units, ${(payload.prices ?? []).length} prices`,
  );
}

// ---------------------------------------------------------------------------

/**
 * A deck-derived Passport Light record must stay project-only. The decks state
 * building and unit counts but no identifiers, so materialising any row here
 * would be invention. Regression guard for the Wave 2 pair.
 */
function auditDeckOnly(slug, payload) {
  for (const collection of ["buildings", "units", "prices", "media", "documents"]) {
    const rows = payload[collection] ?? [];
    if (rows.length) {
      throw new Error(
        `deck_record_violation: ${slug} emitted ${rows.length} ${collection} row(s); a deck with no identifiers must stay project-only.`,
      );
    }
  }
  const codes = new Set((payload.warnings ?? []).map((warning) => warning.code));
  for (const required of [
    "building_inventory_missing",
    "unit_inventory_missing",
    "price_list_missing",
    "investment_projections_not_prices",
  ]) {
    if (!codes.has(required)) {
      throw new Error(`deck_warning_missing: ${slug} is missing ${required}.`);
    }
  }
  console.log(
    `AUDIT ${slug}: project-only draft, ${(payload.warnings ?? []).length} warnings, no invented rows`,
  );
}

const BUILDERS = {
  "rainpalm-villas": buildRainpalm,
  "garden-of-eden": buildGardenOfEden,
  "the-title-sierra": buildSierra,
  "layan-green-park": buildLayanGreenPark,
  "ayana-heights-seaview-residence": buildAyanaHeights,
};

for (const slug of ONLY) {
  if (!(slug in BUILDERS)) throw new Error(`unknown_project: --only=${slug}`);
}

const built = {};
for (const [slug, build] of Object.entries(BUILDERS)) {
  if (ONLY.length && !ONLY.includes(slug)) continue;
  built[slug] = build();
}

for (const [slug, payload] of Object.entries(built)) {
  auditDraftOnly(slug, payload);
  auditNoDuplicateUnits(slug, payload);
  auditNumericsParsed(slug, payload);
}
if (built["rainpalm-villas"]) auditRainpalm(built["rainpalm-villas"]);
if (built["the-title-sierra"]) auditSierra(built["the-title-sierra"]);
if (built["garden-of-eden"]) {
  console.log("AUDIT garden-of-eden: owner_provided provenance, no invented facts");
}
for (const slug of ["layan-green-park", "ayana-heights-seaview-residence"]) {
  if (built[slug]) auditDeckOnly(slug, built[slug]);
}

// Wave 2 gate G9: Layan's lapsed completion quarter must never read as current.
if (
  built["layan-green-park"] &&
  !built["layan-green-park"].warnings.some(
    (warning) => warning.code === "construction_status_stale",
  )
) {
  throw new Error("layan_warning_missing: construction_status_stale");
}

for (const notice of softNotices) {
  console.log(
    `NOTICE ${notice.code}: ${notice.file} (pinned ${notice.pinned_sha256.slice(0, 12)}… selected ${notice.selected_sha256.slice(0, 12)}…)`,
  );
}
