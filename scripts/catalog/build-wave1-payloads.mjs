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
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
};

/** The four conflicting Rainpalm price documents, preserved as evidence only. */
const RAINPALM_PRICE_DOCUMENTS = [
  {
    file: "Rainpalm - Price List（for In house).pdf",
    sha256: "08b4ceb9a71c7dc292cbfec6bf5d34c419687e6097c2d75e25b865ed0a459faf",
    bytes: 77942,
    extractable_prices: 14,
    stated_source_date: null,
    note: "No issue date inside the document; the filename carries none either.",
  },
  {
    file: "Rainpalm - Price List（for In house) update 04.2025.pdf",
    sha256: "4ddee05fe5063bd8548ca8d2833c20bb4ca9b6b81a23aee8f21b065e1b5260b6",
    bytes: 77091,
    extractable_prices: 9,
    stated_source_date: null,
    note: "The only variant with a qualified SIP extraction chain. Supports 9 of the 14 asserted prices; renders D4 as Reserved.",
  },
  {
    file: "Rainpalm - Price List（for In house) update 4_12_2025.pdf",
    sha256: "ac1c213b547d00d5c620cf152a0855c350cb4e193d302ac370ede971f8ae9535",
    bytes: 78944,
    extractable_prices: 21,
    stated_source_date: null,
    note: "Prices all 21 villas with an entirely different schedule (~8-10% below the asserted set). Whether 4_12_2025 means 4 December 2025 or 12 April 2025 is not determinable from the filename.",
  },
  {
    file: "Rainpalm - Price List new.pdf",
    sha256: "772c02f01d030a56dd03512298bb881ccf3d0b7764bd665877a4f6a9ddaf4441",
    bytes: 78261,
    extractable_prices: 14,
    stated_source_date: null,
    note: "Identical 14 values to the undated original. Not confirmed by the Owner to be the same document under a different name.",
  },
];

const RAINPALM_CITED_BUT_ABSENT = "Копия Rainpalm - Price List（for In house)-1.pdf";

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

/**
 * Resolve a pinned source by filename, then prove identity by digest. The
 * resolved absolute path is used but never recorded in any payload.
 */
function requireSource(key) {
  const source = SOURCES[key];
  for (const root of sourceRoots()) {
    const candidate = join(root, source.citation);
    if (!existsSync(candidate)) continue;
    const actual = sha256File(candidate);
    if (actual !== source.sha256) {
      throw new Error(
        `Source digest mismatch for ${source.citation}: expected ${source.sha256}, found ${actual}`,
      );
    }
    return { ...source, path: candidate };
  }
  throw new Error(
    `Source document not found in any configured root: ${source.citation} (expected sha256 ${source.sha256})`,
  );
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

function provenance(sourceRef, status = "developer_provided") {
  return {
    status,
    source_type: "official_project_material",
    source_ref: sourceRef,
    confidence: 1,
  };
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
 * The input is the retained Fast Intake v1 package, never this builder's own
 * output — otherwise a second run would derive from a payload that already had
 * its price layer removed, and the build would not be idempotent.
 */
const RAINPALM_FAST_INTAKE_SHA256 =
  "c95fb84744d9c067a003284be3fd8de5a2a84a2f9cf03a36b2c78b72d283a9b7";

function buildRainpalm() {
  const inputPath = join(
    REPO_ROOT,
    "forever-data",
    "projects",
    "rainpalm-villas",
    "progressive",
    "payload.fast-intake-v1.json",
  );
  const actual = sha256File(inputPath);
  if (actual !== RAINPALM_FAST_INTAKE_SHA256) {
    throw new Error(
      `Rainpalm Fast Intake v1 package digest mismatch: expected ${RAINPALM_FAST_INTAKE_SHA256}, found ${actual}`,
    );
  }
  const existing = JSON.parse(readFileSync(inputPath, "utf8"));

  // Identity is retained verbatim from the validated Fast Intake v1 package.
  const project = existing.project;

  // Structural layer only: identifier, type, bedrooms, bathrooms, size. The
  // availability column is deliberately dropped — every availability value in
  // the package derives from the disputed price documents, and D4 is in open
  // conflict between them.
  const units = existing.units
    .map((unit) => ({
      unit_code: unit.unit_code,
      unit_type: unit.unit_type,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      size_sqm: unit.size_sqm,
    }))
    .sort((a, b) => (a.unit_code < b.unit_code ? -1 : a.unit_code > b.unit_code ? 1 : 0));

  // The seven `price_missing` warnings described a price layer that no longer
  // exists. Retaining them would imply the other fourteen units carry prices.
  const retained = existing.warnings.filter((warning) => warning.code !== "price_missing");

  const warnings = [
    ...retained,
    {
      entity: "project",
      code: "authoritative_price_list_unresolved",
      severity: "warning",
      message:
        "No authoritative Rainpalm price list has been selected. Four conflicting price documents exist; the document cited by the original package is absent; the only variant with a qualified extraction chain supports 9 of the 14 previously asserted prices; and a fourth variant carries an entirely different 21-unit schedule. No unit price was imported. Prices must not be averaged, merged, or selected by filename.",
      payload: {
        cited_source_file_absent: RAINPALM_CITED_BUT_ABSENT,
        conflicting_documents: RAINPALM_PRICE_DOCUMENTS,
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
      message: `Every unit and price row in the previous package cited "${RAINPALM_CITED_BUT_ABSENT}", which does not exist on any inspected source root. The structural layer was therefore re-attributed to the presentation document, which does resolve; no price row was carried over.`,
      payload: { cited_file: RAINPALM_CITED_BUT_ABSENT },
    },
    {
      entity: "unit",
      field: "availability_status",
      code: "availability_unverified",
      severity: "warning",
      message:
        "Availability was not imported. Every availability value in the source package derives from the disputed price documents, so all 21 units carry the schema default and that default must not be read as a verified availability state.",
      payload: { units_affected: units.length },
    },
    {
      entity: "unit",
      field: "availability_status",
      code: "availability_conflict",
      severity: "warning",
      message:
        "Unit D4 is rendered Available by the previous package and Reserved by the one price document with a qualified extraction chain. The conflict is unresolved.",
      payload: {
        unit_code: "D4",
        package_value: "available",
        document_value: "Reserved",
        document: "Rainpalm - Price List（for In house) update 04.2025.pdf",
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
      name: provenance(`${eng.citation}#page=2`),
      location_name_raw: provenance(`${eng.citation}#page=2`),
      location_area: provenance(`${eng.citation}#page=2`),
      project_type: provenance(`${eng.citation}#page=2`),
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

  const towers = [...new Set(sorted.map((row) => row.tower))].sort();
  const buildings = towers.map((tower) => ({
    building_code: tower,
    name: `Tower ${tower}`,
    metadata: {
      field_provenance: {
        building_code: provenance(`${priceList.citation}#column=Tower`),
        name: provenance(`${priceList.citation}#column=Tower`),
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
        "Building rows were derived from the Tower column of the price list, so they cover only towers with listed units. Floor counts and unit counts are not stated and were not derived from the listing, because a price list enumerates offered units rather than a building's full inventory.",
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

buildRainpalm();
buildGardenOfEden();
buildSierra();
