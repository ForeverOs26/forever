/**
 * FOREVER-CATALOG-10-002 / -006 — progressive draft payload builder.
 *
 * Wave 1 (FOREVER-CATALOG-10-002) — the three payloads that task authors:
 *
 *   - rainpalm-villas  structural-only rebuild (prices deliberately removed)
 *   - garden-of-eden   Passport Light from the January 2026 deck
 *   - the-title-sierra Passport Light plus the 2026-05-15 unit price list
 *
 * Wave 2 (FOREVER-CATALOG-10-006) — deck-derived Passport Light:
 *
 *   - ayana-heights-seaview-residence Passport Light from the January 2026 deck
 *
 * AYANA carries no buildings, units or prices. Its deck states building and unit
 * *counts* but no identifiers and no price list, so the counts are preserved as
 * warnings rather than materialised as invented rows.
 *
 * Layan (FOREVER-CATALOG-10-008) — rebuilt from current developer-side sources:
 *
 *   - layan-green-park                Phase 1, from the Phase 1 project guide
 *                                     and the Phase 1 price list
 *
 * Layan is no longer part of the deck family. Its January 2026 agency deck pair
 * was superseded by two current documents that disagree with it on the unit
 * total, the property type, the completion state, the area name and the beach
 * distance, so the record was rebuilt rather than patched. It carries a real
 * price list, but that price list is type-level: five typology bands, no unit
 * identifier anywhere. It therefore still emits zero price rows, because a price
 * row needs a unit_code and inventing one would fabricate inventory. Every fact
 * is scoped to Phase 1, and every transcribed value is asserted back against the
 * pinned document bytes at build time.
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
import { fileURLToPath, pathToFileURL } from "node:url";

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

  // Layan Green Park Phase 1 (FOREVER-CATALOG-10-008). These two documents
  // replace the January 2026 Sunthai Property deck pair entirely: they are the
  // developer-side Phase 1 guide and Phase 1 price list, and every fact in the
  // Layan payload now comes from them.
  //
  // `strictPin` is mandatory here. The Phase 1 and Phase 2 folders of the same
  // Drive tree each hold a file called "Layan Green Park project guide.pdf" and
  // a file called "Layan Green Park price list.pdf". The names are identical;
  // only the digest and the Drive file ID separate them. The ordinary
  // newest-mtime fallback would therefore be free to substitute Phase 2 content
  // into a Phase 1 record without anything looking wrong, so these two refuse to
  // resolve at all unless the pinned digest matches.
  layanPhase1Guide: {
    citation: "Layan Green Park project guide.pdf",
    sha256: "b01ef1e39b9a0c6558230db7d8e7f34caee16c779f8966e8dec2a70c14a19dd4",
    bytes: 25417328,
    strictPin: true,
    driveFileId: "1S121eHy6YuHnhXcr3Xco5VTy65TWr2bR",
    driveParentFolderId: "1Y7bxJp1PnI7h_UgVhZl3HwfVoBK68u7a",
    driveFolderPath: "PHASE 1 / 1. ENGLISH VERSION",
  },
  layanPhase1PriceList: {
    citation: "Layan Green Park price list.pdf",
    sha256: "e91695a0ac52dfc502fc9b6cc64e7c472432a8e5be4e26c07fb60540e40278d3",
    bytes: 6798516,
    strictPin: true,
    driveFileId: "1OaKT8DqmmIVj62qau_m8jm76CxebpnSO",
    driveParentFolderId: "1degE4Hc-kd7xFRoCn3_OfxvXP7Vw4Q7L",
    driveFolderPath: "PHASE 1 / 1. ENGLISH VERSION / 4. Price lists - Phase 1",
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
 *
 * A source marked `strictPin` opts out of that fallback. It exists for documents
 * whose filename is genuinely ambiguous across packages — two phases of the same
 * project shipping identically named files — where taking "the newest one" could
 * silently swap the document's meaning rather than merely its version. For those,
 * a digest miss is fatal.
 */
/**
 * The selection policy, separated from the filesystem so it can be tested
 * exhaustively without Owner source documents present.
 *
 * `candidates` are every readable copy found under the configured roots, each
 * `{path, bytes, sha256, mtime}`. The return is either
 * `{selected, notice: null}` or, for a non-strict source whose pin no longer
 * matches, `{selected, notice}` — never a silent substitution.
 *
 * The rules, in order:
 *  1. A copy matching both the pinned digest and byte length always wins,
 *     whatever root supplied it and whatever its mtime. Root ordering therefore
 *     cannot change the outcome.
 *  2. A `strictPin` source with no matching copy refuses to resolve. This is
 *     what stops a Phase 2 document with an identical filename from being
 *     substituted into a Phase 1 record.
 *  3. Otherwise the newest copy is taken as the clearest version signal, and a
 *     notice records exactly what was selected instead of what was pinned.
 */
function selectPinnedCandidate(source, candidates) {
  if (!candidates.length) {
    throw new Error(
      `source_unreadable: ${source.citation} could not be read in any configured root.`,
    );
  }

  const pinned = candidates.find(
    (item) => item.sha256 === source.sha256 && item.bytes === source.bytes,
  );
  if (pinned) return { selected: { ...source, path: pinned.path }, notice: null };

  if (source.strictPin) {
    throw new Error(
      `source_pin_mismatch: no copy of ${source.citation} matches the pinned digest ` +
        `${source.sha256} (${source.bytes} bytes). ${candidates.length} candidate(s) were read. ` +
        `This source is strictly pinned because the filename alone does not identify the ` +
        `document, so the build refuses to substitute a different one.`,
    );
  }

  const newest = [...candidates].sort((a, b) => b.mtime - a.mtime)[0];
  return {
    selected: { ...source, path: newest.path, sha256: newest.sha256, bytes: newest.bytes },
    notice: {
      code: "source_version_changed",
      file: source.citation,
      pinned_sha256: source.sha256,
      selected_sha256: newest.sha256,
      selected_bytes: newest.bytes,
      candidates: candidates.length,
    },
  };
}

const resolvedSources = new Map();

function requireSource(key) {
  // Memoised per run. The digest pin fixes the bytes for the whole build, so a
  // second lookup can only repeat the first — and repeating it would re-walk
  // every configured root and emit a duplicate drift notice.
  if (resolvedSources.has(key)) return resolvedSources.get(key);

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

  const { selected, notice } = selectPinnedCandidate(source, candidates);
  if (notice) softNotices.push(notice);
  resolvedSources.set(key, selected);
  return selected;
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
 * `pdftotext -layout`, UTF-8. Unlike `-table` this mode carries no Xpdf-only
 * contract, so it runs on any pdftotext build and needs no vendor assertion.
 */
function pdfToLayoutText(path) {
  const workspace = mkdtempSync(join(tmpdir(), "forever-layout-"));
  try {
    const out = join(workspace, "out.txt");
    execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, out], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Collapse whitespace so a transcribed phrase can be located in extracted text
 * regardless of how the extractor broke lines or padded columns. Thin, narrow
 * and non-breaking spaces are folded to an ordinary space; nothing else is
 * altered, so a Cyrillic character in the source stays Cyrillic here.
 */
function normalizeExtractedText(text) {
  return text
    .replace(/[    ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Assert that every transcribed phrase really occurs in the pinned document.
 *
 * The digest pin proves which bytes were read; this proves the payload's
 * hand-transcribed facts still describe those bytes. Together they are what
 * makes the record reproducible rather than merely stable. A phrase that no
 * longer occurs is fatal: the document moved on and the transcription must be
 * re-derived by a human, not silently kept.
 */
function assertTranscribedFacts(label, extractedText, phrases) {
  const haystack = normalizeExtractedText(extractedText);
  const missing = phrases.filter((phrase) => !haystack.includes(normalizeExtractedText(phrase)));
  if (missing.length) {
    throw new Error(
      `source_text_missing: ${label} no longer contains ${missing.length} transcribed phrase(s). ` +
        `First: ${JSON.stringify(missing[0])}`,
    );
  }
  return phrases.length;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let total = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    total++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return total;
}

/**
 * Assert a *material* claim, with a constraint stronger than "these characters
 * appear somewhere in the file".
 *
 * `assertTranscribedFacts` is a bare substring test over the whole normalised
 * document. That is the right guard for a long quoted sentence, but it is far
 * too weak for the claims a record actually rests on: a bare `"248"` matches any
 * `248` anywhere in a 7 500-character document, and four separate fragments
 * prove nothing about the sentence the payload quotes as contiguous. A revision
 * of the source could keep every fragment and still destroy the claim.
 *
 * Four claim shapes, chosen to match the forms the documents really support:
 *
 * - `contiguous` — the phrase occurs as one unbroken run. Optionally with
 *   `occurrences`, when the count is itself the evidence.
 * - `ordered` + `withinChars` — the parts occur in order, each within a bounded
 *   gap of the previous. This is for facts that are correct on the page's column
 *   geometry but interleave in the text layer, where a contiguous assertion is
 *   impossible rather than merely inconvenient.
 * - `absent` — the phrase must not occur. A derivation that exists only because
 *   the document is silent needs the silence asserted, or it can rot unnoticed.
 */
function assertMaterialClaims(label, extractedText, claims) {
  const haystack = normalizeExtractedText(extractedText);
  for (const claim of claims) {
    const where = `${label} / ${claim.id}`;

    if (claim.absent !== undefined) {
      if (haystack.includes(normalizeExtractedText(claim.absent))) {
        throw new Error(
          `material_claim_broken: ${where} requires ${JSON.stringify(claim.absent)} to be absent, ` +
            `but the document now contains it. ${claim.why}`,
        );
      }
      continue;
    }

    if (claim.ordered) {
      let cursor = 0;
      let previousEnd = null;
      for (const part of claim.ordered) {
        const needle = normalizeExtractedText(part);
        const at = haystack.indexOf(needle, cursor);
        if (at === -1) {
          throw new Error(
            `material_claim_broken: ${where} no longer contains ${JSON.stringify(part)} ` +
              `in the required order. ${claim.why}`,
          );
        }
        if (previousEnd !== null && at - previousEnd > claim.withinChars) {
          throw new Error(
            `material_claim_broken: ${where} still contains ${JSON.stringify(part)}, but ` +
              `${at - previousEnd} characters away from the previous part — beyond the ` +
              `${claim.withinChars}-character bound that makes them one statement. ${claim.why}`,
          );
        }
        previousEnd = at + needle.length;
        cursor = previousEnd;
      }
      continue;
    }

    const needle = normalizeExtractedText(claim.contiguous);
    const found = countOccurrences(haystack, needle);
    if (found === 0) {
      throw new Error(
        `material_claim_broken: ${where} no longer contains the contiguous phrase ` +
          `${JSON.stringify(claim.contiguous)}. ${claim.why}`,
      );
    }
    if (claim.occurrences !== undefined && found !== claim.occurrences) {
      throw new Error(
        `material_claim_broken: ${where} expects ${JSON.stringify(claim.contiguous)} exactly ` +
          `${claim.occurrences} time(s); the document now has ${found}. ${claim.why}`,
      );
    }
  }
  return claims.length;
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
  const { confidence = 1, note, sourceDate, undatedBySource } = options;
  if (sourceDate && undatedBySource) {
    throw new Error(
      "provenance_date_conflict: a fact is either dated by its source or it is not. " +
        "Pass sourceDate or undatedBySource, never both.",
    );
  }
  const result = {
    status: "owner_provided",
    source_type: "owner_uploaded_project_material",
    source_ref: sourceRef,
    confidence,
  };
  if (sourceDate) result.source_date = sourceDate;
  if (note) result.note = note;
  if (undatedBySource) {
    // The honest undated form. `reasoning` is the FieldProvenance schema's own
    // free-form slot (src/features/forever-ingestion/provenance.ts), so this
    // needs no schema change.
    //
    // Recording the absence explicitly is stronger than dropping the key in
    // silence: it says the document was read and states no date for this fact,
    // which a later freshness policy must not confuse with "not looked at yet".
    // Borrowing a date the document states about something else would be
    // weaker still — it would make a descriptive fact look as current as a
    // price.
    result.reasoning = { source_date: "undated_by_source", why: undatedBySource };
  }
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
// 3. AYANA Heights Seaview Residence — Wave 2 deck record
//
// Comes from the same January 2026 Sunthai Property deck family as Garden of
// Eden and is built the same way: source-stated facts are transcribed with a
// page citation, and anything the deck does not state stays absent behind a
// warning. The deck contains no price list and no per-unit identifier, so the
// record is project-only — zero buildings, zero units, zero prices.
//
// Layan Green Park no longer belongs to this family; see section 3b.
// ---------------------------------------------------------------------------

/**
 * AYANA ships two PDFs. The second is NOT a translation: its text layer is the
 * same English deck with the closing agency-contact page removed. The onboarding
 * register describes that second file as Russian; the label does not survive
 * inspection of the document's own text, so it is not repeated in the payload.
 * Recorded per document rather than asserted globally.
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

// ---------------------------------------------------------------------------
// 3b. Layan Green Park — Phase 1, from the current developer-side documents
//
// This record is no longer deck-derived. It is built from the Phase 1 project
// guide and the Phase 1 price list, and it replaces a payload derived from a
// January 2026 agency deck pair that stated a different unit total, a different
// property type, a lapsed completion quarter and a beach distance in metres —
// none of which occurs in the current evidence.
//
// Three properties make this record honest, and each is enforced rather than
// asserted:
//
//   - Every fact is scoped to Phase 1. The guide covers both phases and gives
//     them different figures, so an unscoped project-level claim would be false
//     for one of them.
//   - The price list is type-level. It states five typology bands and no unit
//     identifier at all, so it produces zero price rows: a price row needs a
//     unit_code, and inventing one would fabricate inventory.
//   - Every transcribed value is asserted back against the pinned bytes at build
//     time, so a typo cannot reach the payload and a changed document cannot
//     pass silently.
// ---------------------------------------------------------------------------

/** Digit grouping with spaces, matching how both documents print numbers. */
function spaceGrouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Four decimal places, enough to separate the document's distinct FX rates. */
function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/** Two decimal places, the precision at which the document quotes a rate. */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The Phase 1 price list, page 1, transcribed verbatim. `size_text` keeps the
 * source's own characters: the duplex row really does print a Cyrillic м and a
 * comma decimal separator where the other four print a Latin m and a point.
 * `sold_state` is null unless the document itself prints a state.
 */
const LAYAN_PHASE1_PRICE_BANDS = [
  {
    type_label: "Studios",
    size_text: "from 30.3 m2",
    size_from_sqm: 30.3,
    from_thb: 5000000,
    from_usd: 150286,
    to_thb: 10371600,
    to_usd: 311740,
    sold_state: null,
  },
  {
    type_label: "1-BR",
    size_text: "from 45.4 m2",
    size_from_sqm: 45.4,
    from_thb: 9034600,
    from_usd: 271554,
    to_thb: 14086800,
    to_usd: 423408,
    sold_state: null,
  },
  {
    type_label: "2-BR",
    size_text: "from 90.4 m2",
    size_from_sqm: 90.4,
    from_thb: 16398000,
    from_usd: 492876,
    to_thb: 30240000,
    to_usd: 908927,
    sold_state: null,
  },
  {
    type_label: "3-BR",
    size_text: "from 126.6 m2",
    size_from_sqm: 126.6,
    from_thb: 28000000,
    from_usd: 841599,
    to_thb: 38000000,
    to_usd: 1142170,
    sold_state: null,
  },
  {
    type_label: "Duplexes",
    size_text: "from 120,9 м2",
    // The document overlaps two text runs here: "from" and "SOLD" occupy the
    // same horizontal space, so extraction interleaves them character by
    // character into "fSroOmLD". That interleaving is the evidence for the SOLD
    // state — it is not noise, and the assertion is made against it rather than
    // against the reconstructed reading, so the reconstruction stays checkable.
    size_text_extracted: "fSroOmLD120,9 м2",
    size_from_sqm: 120.9,
    from_thb: 38230971,
    from_usd: 1215998,
    to_thb: 49499178,
    to_usd: 1574401,
    sold_state: "SOLD",
  },
];

/**
 * The Phase 1 column of the guide's layout-solutions table. The table's two
 * columns are unlabelled in the document, so this attribution is derived, not
 * stated; the derivation and its three corroborations are recorded in the
 * `price_band_phase_scope_derived` warning. Kept separate from the price-list
 * bands above so guide evidence and price-list evidence never merge.
 */
const LAYAN_PHASE1_GUIDE_BANDS = [
  {
    type_label: "STUDIOS",
    size_text: "30-48 m2",
    from_thb: 5000000,
    from_usd: 150286,
    sold_state: null,
  },
  {
    type_label: "ONE-BEDROOM",
    size_text: "45-67 m2",
    from_thb: 9034600,
    from_usd: 271554,
    sold_state: null,
  },
  {
    type_label: "TWO-BEDROOM",
    size_text: "90-144 m2",
    from_thb: 16398000,
    from_usd: 492876,
    sold_state: null,
  },
  {
    type_label: "THREE-BEDROOM",
    size_text: "127-130 m2",
    from_thb: 28000000,
    from_usd: 841599,
    sold_state: null,
  },
  {
    type_label: "DUPLEXES",
    size_text: "109 m2",
    from_thb: null,
    from_usd: null,
    sold_state: "Sold",
  },
];

/**
 * Guide size floor against price-list size floor, per typology. Four pairs are
 * consistent with the guide rounding to whole square metres; the duplex pair is
 * not, and that is the point of recording all five.
 */
const LAYAN_PHASE1_SIZE_COMPARISONS = LAYAN_PHASE1_GUIDE_BANDS.map((guideBand, index) => {
  const priceBand = LAYAN_PHASE1_PRICE_BANDS[index];
  return {
    guide_type_label: guideBand.type_label,
    guide_size_text: guideBand.size_text,
    price_list_type_label: priceBand.type_label,
    price_list_size_text: priceBand.size_text,
    price_list_size_from_sqm: priceBand.size_from_sqm,
    explained_by_rounding: Math.abs(priceBand.size_from_sqm - parseFloat(guideBand.size_text)) < 1,
  };
});

/**
 * Phase 1 guide phrases asserted against the pinned guide bytes. Transcribed
 * with the document's own characters, so the apostrophes are U+2019 and the
 * building separators are U+2014 em dashes, not ASCII lookalikes.
 */
const LAYAN_PHASE1_GUIDE_PHRASES = [
  "LAYAN GREEN PARK is Phuket’s first eco-friendly development, officially recognized and certified by the international EDGE standard.",
  "Located in Bang Tao, the island’s most prestigious area",
  "is just two minutes from the serene, white-sand Layan Beach, stretching for seven kilometers.",
  "phuket | thailand",
  "First premium",
  "condo-hotel",
  "certificated",
  "by EDGE",
  "Two construction phases",
  "Construction completed",
  "in 2024",
  "30 m² - 144 m²",
  "9 940 m²",
  "Number of buildings",
  "Number of apartments",
  "248",
  "of construction completed",
  "increase in the value of apartments",
  "Over 60%",
  "of apartments sold",
  "296",
  "37 m² - 269 m²",
  "16 673 m²",
  "Completion of construction",
  "Infrastructure",
  "Building A —",
  "Mangosteen",
  "Building D —",
  "Duplex",
  "Layan beach, shuttle",
  "2 MIN",
  "A total of 20,000 sq. m. of on-site facilities",
  "over 40% of the",
  "Layout solutions",
  "30+ planning options",
  "from 30 to 269 m² | from studios to duplexes",
  "Price valid as of July 1, 2026",
  "transfers 60% of net profit to the owners.",
  "Reservation deposit of THB 200,000.",
  "increase by 10-15%",
  "layangreenpark.com",
];

/**
 * The Layan Phase 1 claims this record actually rests on, asserted against the
 * guide's pinned bytes in a form strong enough to fail if the claim stops being
 * true. Every phrase below was verified to hold against the pinned document.
 *
 * The guide's stat block prints Phase 1 and Phase 2 side by side, so several
 * Phase 1 figures interleave with their Phase 2 counterparts in the text layer.
 * Where that happens the interleaved run is asserted whole — it is the evidence
 * for the column geometry, so weakening it to separate fragments would discard
 * the very thing that tells the two phases apart.
 */
const LAYAN_PHASE1_GUIDE_MATERIAL_CLAIMS = [
  {
    id: "two_construction_phases",
    contiguous: "Two construction phases",
    why: "Every fact here is scoped to Phase 1, which is only meaningful if the document really describes two phases.",
  },
  {
    id: "phase_1_apartments_248",
    contiguous: "Phase 1 248",
    occurrences: 1,
    why: "248 must be bound to Phase 1. A bare '248' would match anywhere in the document, including the Phase 2 stat block.",
  },
  {
    id: "phase_1_buildings_4_with_phase_2_buildings_6",
    contiguous: "Construction completed 6 4 in 2024 Number of buildings Number of buildings",
    why: "The building counts are column-interleaved: 6 is Phase 2's and 4 is Phase 1's. Asserting the whole run pins the geometry the attribution depends on, and is the strongest form this fact takes in the text layer.",
  },
  {
    id: "phase_1_completion_2024",
    ordered: ["Construction completed", "in 2024"],
    withinChars: 8,
    why: "The payload quotes 'Construction completed in 2024'. The two halves are split by the interleaved building counts, so proximity is the strongest available proof that they are one statement.",
  },
  {
    id: "location_bang_tao",
    contiguous: "Located in Bang Tao, the island’s most prestigious area",
    why: "location_name_raw and location_area are both 'Bang Tao'. The full sentence proves the area attribution rather than a stray mention.",
  },
  {
    id: "country_thailand",
    contiguous: "phuket | thailand",
    occurrences: 4,
    why: "country_stated_not_modelled claims the country is stated four times. The count is the evidence, so it is asserted rather than described.",
  },
  {
    id: "project_type_sentence",
    contiguous: "First premium condo-hotel certificated by EDGE",
    why: "project_type quotes this as one contiguous sentence. It was previously asserted as four separate fragments, which would survive a revision that broke the sentence apart.",
  },
  {
    id: "phase_1_size_range",
    contiguous: "30 m² - 144 m²",
    why: "Phase 1's apartment size range, and one of the four figures that differ between the phases.",
  },
  {
    id: "phase_1_site_area",
    contiguous: "9 940 m²",
    why: "Phase 1's site area, distinct from Phase 2's.",
  },
  {
    id: "phase_2_size_range_stated_not_ingested",
    contiguous: "37 m² - 269 m²",
    why: "Phase 2 exclusion is only defensible if the document really states different Phase 2 figures. This is one of them, and no Phase 2 value is ingested.",
  },
  {
    id: "phase_2_site_area_stated_not_ingested",
    contiguous: "16 673 m²",
    why: "The second distinct Phase 2 figure supporting the exclusion.",
  },
];

/**
 * The price list's five type-level bands, asserted as whole rows. Each row
 * extracts contiguously, so the type label, size and all four money figures are
 * proven to belong to one another rather than merely to co-occur in the file.
 *
 * The duplex row carries its own evidence of the SOLD state: the document
 * overlaps the "from" and "SOLD" runs, so they interleave into "fSroOmLD". The
 * assertion is made against that raw interleaving, which keeps the reading
 * checkable instead of assumed.
 */
const LAYAN_PHASE1_PRICE_BAND_MATERIAL_CLAIMS = LAYAN_PHASE1_PRICE_BANDS.map((band) => ({
  id: `price_band_row_${band.type_label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  contiguous:
    `${band.type_label} ${band.size_text_extracted ?? band.size_text} ` +
    `from ${spaceGrouped(band.from_thb)} THB | ${spaceGrouped(band.from_usd)} USD ` +
    `to ${spaceGrouped(band.to_thb)} THB | ${spaceGrouped(band.to_usd)} USD`,
  why:
    `The ${band.type_label} band is emitted as one row, so it is asserted as one row. ` +
    (band.sold_state
      ? "This row also carries the interleaved SOLD evidence for the duplex band."
      : "Separate fragment assertions would not prove the figures belong to this type."),
}));

/** Price-list claims beyond the band rows themselves. */
const LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS = [
  ...LAYAN_PHASE1_PRICE_BAND_MATERIAL_CLAIMS,
  {
    id: "price_validity_date_stated",
    contiguous: "price valid as of July 1, 2026",
    why: "The source date for price facts is this printed statement, not a file timestamp.",
  },
  {
    id: "secondary_validity_date_stated_in_russian",
    contiguous: "Цена актуальна на 02.02.2026",
    why: "The second price-validity statement is recorded as an unresolved conflict, so the whole sentence is asserted — a bare '02.02.2026' would not prove it is a price-validity statement at all.",
  },
  {
    id: "fx_rate_stated_page_1",
    contiguous: "1 USD = 33.3 THB",
    why: "One of the two directly printed FX rates counted by price_fx_inconsistent.",
  },
  {
    id: "fx_rate_stated_page_2",
    contiguous: "1 USD = 31,25 THB",
    why: "The second directly printed FX rate, with the document's own comma decimal separator.",
  },
  {
    id: "price_list_states_no_phase_en",
    absent: "Phase",
    why: "price_band_phase_scope_derived is honest only while the price list itself states no phase. If the document ever names one, the derivation must be revisited rather than silently kept.",
  },
  {
    id: "price_list_states_no_phase_ru",
    absent: "фаза",
    why: "The same silence, checked in the document's other language.",
  },
];

/**
 * Why the four descriptive Layan project fields carry no source date.
 *
 * Both documents print "valid as of July 1, 2026" — but against their price
 * tables. That statement dates prices. Neither document states a publication or
 * business-effective date for the project's name, location or type, so those
 * facts are undated by their source and are recorded as such.
 */
const LAYAN_UNDATED_BY_SOURCE =
  'Neither pinned document states a publication or business-effective date for this fact. The only date wording in either file is a price-validity statement ("Price valid as of July 1, 2026") printed against the price table, which dates prices and not descriptive project facts. That date is retained on price facts and recorded in full under source_date_recorded.';

/** Phase 1 price-list phrases asserted against the pinned price-list bytes. */
const LAYAN_PHASE1_PRICE_PHRASES = [
  "The cost of apartments",
  "discover the latest pricing in the",
  "price valid as of July 1, 2026",
  "1 USD = 33.3 THB",
  "1 USD = 31,25 THB",
  "02.02.2026",
];

function buildLayanGreenPark() {
  const guide = requireSource("layanPhase1Guide");
  const priceList = requireSource("layanPhase1PriceList");

  // The guide is a single Figma artboard exported as one PDF page, so a page
  // number carries no information. Sections are cited by the heading the
  // document itself prints.
  const guideCite = (section) => `${guide.citation}#page=1;section=${section}`;
  const priceCite = (page) => `${priceList.citation}#page=${page}`;

  const guideText = pdfToLayoutText(guide.path);
  const priceText = pdfToLayoutText(priceList.path);

  // Every transcribed value below is asserted back against the pinned bytes, so
  // a typo here cannot reach the payload and a changed document cannot pass
  // silently. The phrase lists are generated from the same constants that
  // populate the payload, never written out twice.
  const priceBandPhrases = LAYAN_PHASE1_PRICE_BANDS.flatMap((band) => [
    band.type_label,
    band.size_text_extracted ?? band.size_text,
    `from ${spaceGrouped(band.from_thb)} THB | ${spaceGrouped(band.from_usd)} USD`,
    `to ${spaceGrouped(band.to_thb)} THB | ${spaceGrouped(band.to_usd)} USD`,
  ]);
  const guideBandPhrases = LAYAN_PHASE1_GUIDE_BANDS.flatMap((band) =>
    band.from_thb === null
      ? [band.type_label, band.size_text, band.sold_state]
      : [
          band.type_label,
          band.size_text,
          `from ${spaceGrouped(band.from_thb)} THB`,
          `from ${spaceGrouped(band.from_usd)} USD`,
        ],
  );

  const guidePhrasesVerified = assertTranscribedFacts(guide.citation, guideText, [
    ...LAYAN_PHASE1_GUIDE_PHRASES,
    ...guideBandPhrases,
  ]);
  const pricePhrasesVerified = assertTranscribedFacts(priceList.citation, priceText, [
    ...LAYAN_PHASE1_PRICE_PHRASES,
    ...priceBandPhrases,
  ]);

  // The phrase lists above prove the transcriptions are still present. These
  // prove the material claims are still *true* — that the figures remain bound
  // to the phase, the type and the sentence the payload attributes them to. The
  // fragment check cannot do that, so both run.
  const guideClaimsVerified = assertMaterialClaims(
    guide.citation,
    guideText,
    LAYAN_PHASE1_GUIDE_MATERIAL_CLAIMS,
  );
  const priceClaimsVerified = assertMaterialClaims(
    priceList.citation,
    priceText,
    LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS,
  );

  // Implied rates are computed, never transcribed, so they cannot disagree with
  // the band values they are derived from.
  const impliedRates = LAYAN_PHASE1_PRICE_BANDS.map((band) => ({
    type_label: band.type_label,
    implied_from_rate: round4(band.from_thb / band.from_usd),
    implied_to_rate: round4(band.to_thb / band.to_usd),
  }));
  // Grouped at two decimals. The per-band figures above differ in their last
  // digits only because the document's USD column is rounded to whole dollars,
  // so quoting every 4-decimal value as a distinct rate would invent a
  // difference the document does not have. Grouping is a presentation choice
  // about the derived figures; it never touches the printed THB or USD values,
  // and the conflicting rates are preserved, not normalised away.
  const impliedRateGroups = [
    ...new Set(
      impliedRates.flatMap((row) => [round2(row.implied_from_rate), round2(row.implied_to_rate)]),
    ),
  ].sort((a, b) => a - b);

  const project = {
    slug: "layan-green-park",
    name: "Layan Green Park",
    developer_id: null,
    location_id: null,
    publish: false,
    location_name_raw: "Bang Tao",
    location_area: "Bang Tao",
    project_type: "Premium condo-hotel",
    // None of these four fields carries a source date. The only date either
    // document states is a price-validity statement printed against the price
    // table, which dates prices and says nothing about the project's name,
    // location or type. See `source_date_recorded` for the full date record.
    field_provenance: {
      name: provenance(guideCite("Two construction phases"), {
        undatedBySource: LAYAN_UNDATED_BY_SOURCE,
      }),
      location_name_raw: provenance(guideCite("Overview"), {
        undatedBySource: LAYAN_UNDATED_BY_SOURCE,
        note: 'The guide states "Located in Bang Tao, the island’s most prestigious area". The earlier deck-derived record said "Layan", which this source does not support as the area name; Layan is named only as the neighbouring beach.',
      }),
      location_area: provenance(guideCite("Overview"), {
        undatedBySource: LAYAN_UNDATED_BY_SOURCE,
      }),
      project_type: provenance(guideCite("Overview"), {
        undatedBySource: LAYAN_UNDATED_BY_SOURCE,
        note: 'The guide states "First premium condo-hotel certificated by EDGE". Neither current source contains the earlier deck\'s "PREMIUM APART-HOTEL" or "Condominiums" wording, so the previously recorded project_type_inconsistent conflict has no basis in the current evidence and was removed rather than carried forward.',
      }),
    },
  };

  const warnings = [
    {
      entity: "project",
      code: "phase_scope_phase_1_only",
      severity: "warning",
      message:
        "Every fact in this record is scoped to Phase 1. The guide describes two phases under one project name and states different figures for each, so a project-level assertion would be false for one of them. The slug names the whole project; the content does not. Phase 2 figures appear below only where they are needed to show how a Phase 1 reading was established, and are never ingested as Phase 1 values.",
      payload: {
        phase: "Phase 1",
        phase_1_stated: {
          buildings: 4,
          apartments: 248,
          apartment_size: "30 m² - 144 m²",
          site_area: "9 940 m²",
          construction: "Construction completed in 2024",
          construction_completed_share: "100%",
        },
        phase_2_stated_not_ingested: {
          buildings: 6,
          apartments: 296,
          apartment_size: "37 m² - 269 m²",
          site_area: "16 673 m²",
          completion_of_construction: "2026",
          apartments_sold: "Over 60%",
        },
        source_refs: [guideCite("Two construction phases"), guideCite("Project information")],
      },
    },
    {
      entity: "project",
      code: "phase_2_sources_not_ingested",
      severity: "warning",
      message:
        "An equally current Phase 2 guide and Phase 2 price list exist in the same Drive tree and were deliberately not retrieved or ingested by this task. They are not stale, superseded or missing — they are out of scope. Critically, the Phase 2 files carry byte-for-byte identical filenames to the two Phase 1 files ingested here, so a filename alone never identifies which phase a document describes; only the Drive file ID and the SHA-256 digest do. Anything that resolves these documents by name must pin the digest.",
      payload: {
        phase_2_documents: [
          {
            file: "Layan Green Park project guide.pdf",
            drive_file_id: "1MMNrkdkL7ftf7RbvRrEh9gLnapMBaZXh",
            drive_folder_path: "PHASE 2 / 1. ENGLISH VERSION",
            ingested: false,
          },
          {
            file: "Layan Green Park price list.pdf",
            drive_file_id: "1lb-VXuvtaFvWyPE4H4s1CF0x2lqUmS8F",
            drive_folder_path: "PHASE 2 / 1. ENGLISH VERSION / 4. Price lists - Phase 2",
            ingested: false,
          },
        ],
        filename_collision_with_phase_1: true,
      },
    },
    {
      entity: "developer",
      code: "developer_unresolved",
      severity: "warning",
      message:
        "Neither current source names a developer, a legal entity or a seller. No canonical developer could be resolved and no raw developer name could be preserved either, because there is none to preserve. The guide is developer-side project material rather than agency material, but it never identifies its own publisher beyond the project website.",
      payload: {
        source_documents: [guide.citation, priceList.citation],
        only_publisher_signal: "layangreenpark.com",
        note: 'The same Drive tree contains a folder named "10. Developer\'s portfolio" for both phases. It was not retrieved: this task is bounded to the two verified documents, and resolving the developer from an unretrieved folder would be inference. That folder is the obvious next evidence source.',
      },
    },
    {
      entity: "location",
      code: "location_unresolved",
      severity: "warning",
      message:
        'The guide states "Located in Bang Tao, the island’s most prestigious area" and prints "phuket | thailand" as a running header. No canonical location row was resolved offline, so the raw values were preserved for later enrichment. The earlier record\'s area value "Layan" is not supported by this source: Layan appears only as the name of the neighbouring beach.',
      payload: {
        raw_name: "Bang Tao",
        island: "Phuket",
        country: "Thailand",
        source_refs: [guideCite("Overview"), guideCite("Two construction phases")],
      },
    },
    {
      entity: "project",
      code: "country_stated_not_modelled",
      severity: "info",
      message:
        'The country is directly stated. The guide prints "phuket | thailand" as a running header on four sections. The projects table has no country column — country lives on locations — so the value is preserved here and belongs to the canonical location this project is later attached to. This supersedes the earlier country_missing warning, which is no longer true of the current evidence.',
      payload: {
        country: "Thailand",
        province: "Phuket",
        stated_as: "phuket | thailand",
        supersedes: "country_missing",
      },
    },
    {
      entity: "project",
      field: "latitude",
      code: "coordinates_missing",
      severity: "info",
      message: "No coordinates are stated in either source; latitude/longitude remain NULL.",
    },
    {
      entity: "project",
      field: "construction_status",
      code: "construction_status_phase_dependent",
      severity: "warning",
      message:
        'Phase 1 is stated complete — "Construction completed in 2024" and "100% of construction completed" — while the same guide gives Phase 2 a completion of 2026. A single project-level construction_status would therefore misstate one phase, so the column stays NULL and both stated states are preserved here. This replaces the earlier construction_status_stale warning, whose lapsed completion quarter is listed under superseded_source_claims_removed.',
      payload: {
        phase_1: {
          stated: "Construction completed in 2024",
          completed_share: "100%",
          source_refs: [guideCite("Two construction phases"), guideCite("Project information")],
        },
        phase_2_not_ingested: { completion_of_construction: "2026" },
        supersedes: ["construction_status_stale", "construction_status_missing"],
      },
    },
    {
      entity: "project",
      field: "completion_date",
      code: "completion_year_only",
      severity: "info",
      message:
        'Phase 1 completion is stated as a year — "in 2024" — not a date. A year is not a date, so completion_date remains NULL rather than being resolved to an invented month and day.',
      payload: { stated: "2024", source_ref: guideCite("Two construction phases") },
    },
    {
      entity: "building",
      code: "building_inventory_missing",
      severity: "warning",
      message:
        'The guide states "Number of buildings: 4" for Phase 1 but never lists which buildings those are. Its infrastructure section does name eleven buildings — A Mangosteen, B Leelawadee, C Colibri, D Duplex, F, G, H, J1, J2, K and L — but assigns none of them to a phase, and eleven names cannot be reconciled with the stated 4 + 6 = 10 buildings across both phases. Selecting four of those names as the Phase 1 set would be inference, so no building row was created.',
      payload: {
        stated_phase_1_count: 4,
        named_buildings_unassigned_to_phase: [
          "Building A — Mangosteen",
          "Building B — Leelawadee",
          "Building C — Colibri",
          "Building D — Duplex",
          "Building F",
          "Building G",
          "Building H",
          "Building J1",
          "Building J2",
          "Building K",
          "Building L",
        ],
        stated_total_buildings_both_phases: 10,
        named_building_labels_observed: 11,
        source_refs: [guideCite("Two construction phases"), guideCite("Infrastructure")],
      },
    },
    {
      entity: "unit",
      code: "unit_inventory_missing",
      severity: "warning",
      message:
        "The guide states 248 apartments for Phase 1, twice and consistently. Neither source contains a unit number, a room number, a floor schedule or any other per-unit identifier, so the stated total is preserved here and no unit row was created. The total this record previously carried came from a superseded document and is listed under superseded_source_claims_removed.",
      payload: {
        stated_phase_1_apartments: 248,
        source_refs: [guideCite("Two construction phases"), guideCite("Project information")],
      },
    },
    {
      entity: "unit",
      code: "unit_types_type_level_only",
      severity: "warning",
      message:
        'Five apartment typologies are stated with size bands — studios, one-bedroom, two-bedroom, three-bedroom and duplexes — and the guide advertises "30+ planning options from 30 to 269 m² | from studios to duplexes" across both phases. A typology is not a unit: there is no schedule mapping any typology to a countable set of identified apartments, so no unit row was created. This replaces the earlier unit_types_missing warning, which is no longer true — types are stated, individual units are not.',
      payload: {
        typologies: LAYAN_PHASE1_PRICE_BANDS.map((band) => band.type_label),
        planning_options_both_phases: "30+ planning options from 30 to 269 m²",
        supersedes: "unit_types_missing",
        source_refs: [guideCite("Layout solutions"), priceCite(1)],
      },
    },
    {
      entity: "price",
      code: "price_bands_type_level_only",
      severity: "warning",
      message:
        'A current Phase 1 price list exists and is ingested here as type-level bands, which is the only shape the source actually has. It states a minimum size and a THB and USD price range for each of five typologies. It contains no unit identifier, no per-unit price, no inventory and no availability column, and it explicitly defers to the project website for "the latest pricing", so no price row was created: a price row requires a unit_code, and manufacturing one would invent inventory the source does not have. This replaces the earlier price_list_missing warning, which is no longer true.',
      payload: {
        price_list_date: "2026-07-01",
        stated_as: "price valid as of July 1, 2026",
        currencies_quoted: ["THB", "USD"],
        bands: LAYAN_PHASE1_PRICE_BANDS,
        band_count: LAYAN_PHASE1_PRICE_BANDS.length,
        building_level_bands_present: false,
        supersedes: "price_list_missing",
        source_ref: priceCite(1),
        document_defers_to:
          'The cost of apartments … discover the latest pricing in the "Unit plans and prices" section of our website.',
      },
    },
    {
      entity: "price",
      field: "currency",
      code: "price_fx_inconsistent",
      severity: "warning",
      message:
        "The price list disagrees with itself about the THB/USD rate, so its USD column cannot be treated as a reliable conversion of its THB column. Two rates are printed directly, one per page, and they differ from each other. A further two rates are implied by dividing the printed THB endpoints by the printed USD endpoints: the studio-to-three-bedroom rows imply one, the duplex row implies another. That is four rates in total — two printed, two implied — across four distinct readings of the same document. Both currencies are preserved exactly as printed; neither was recomputed, rounded or normalised to a single rate.",
      payload: {
        // Each count below answers a different question. They are deliberately
        // reported separately: the earlier record collapsed them into one
        // figure that matched none of them.
        rate_counts: {
          // Rates the document prints as a rate, in words, on the page.
          printed_directly: 2,
          // Price endpoints compared: 5 bands × {from, to}.
          price_endpoints_compared: impliedRates.length * 2,
          // Distinct implied rates at the 4-decimal precision recorded below.
          distinct_implied_rates_4dp: new Set(
            impliedRates.flatMap((row) => [row.implied_from_rate, row.implied_to_rate]),
          ).size,
          // Distinct implied rates once grouped to 2 decimals.
          distinct_implied_rate_groups_2dp: impliedRateGroups.length,
          // Printed + grouped implied, i.e. the readings the message counts.
          distinct_readings_total: 2 + impliedRateGroups.length,
        },
        stated_rate_page_1: "1 USD = 33.3 THB",
        stated_rate_page_2: "1 USD = 31,25 THB",
        implied_by_band: impliedRates,
        implied_rate_groups: impliedRateGroups,
        implied_rate_precision_note:
          "Per-band figures are recorded to four decimals. They vary in their last digits only because the document rounds its USD column to whole dollars, so the 4-decimal spread is an artefact of that rounding rather than a real third rate. Grouped to two decimals the ten compared price endpoints yield the two implied rates listed in implied_rate_groups.",
        note: "The duplex row is the outlier at 31.44, and it is also the only row printed with a Cyrillic м and a comma decimal separator — see price_band_source_anomalies.",
        source_refs: [priceCite(1), priceCite(2)],
      },
    },
    {
      entity: "price",
      code: "price_band_phase_scope_derived",
      severity: "warning",
      message:
        'The price list never says "Phase 1" anywhere in its own text. Its Phase 1 scope rests on its Drive location — it is the only file in the folder "4. Price lists - Phase 1" — corroborated by three independent arithmetic identities against the guide. The scope is therefore well-supported but derived, not stated, and it is recorded as derived so it can be audited rather than trusted.',
      payload: {
        basis: "drive_folder_path",
        drive_folder_path: "PHASE 1 / 1. ENGLISH VERSION / 4. Price lists - Phase 1",
        drive_file_id: "1OaKT8DqmmIVj62qau_m8jm76CxebpnSO",
        in_document_phase_statement: null,
        corroborations: [
          'The guide\'s layout-solutions table has two unlabelled columns. One spans 30-144 m², exactly the stated Phase 1 range "30 m² - 144 m²"; the other spans 37-269 m², exactly the stated Phase 2 range "37 m² - 269 m²".',
          "All four non-duplex THB floor prices in that first column are identical to the four non-duplex THB floor prices in this price list.",
          "That first column marks DUPLEXES as Sold while the second column marks STUDIOS as Sold; this price list marks Duplexes as SOLD, matching the first column.",
        ],
        uncorroborated_band: {
          type_label: "Duplexes",
          reason:
            "Its 120,9 m² floor matches neither the 109 m² the guide gives Phase 1 duplexes nor the 208-269 m² it gives Phase 2 duplexes, and it is the one band whose implied FX rate differs from the rest.",
        },
      },
    },
    {
      entity: "price",
      code: "price_band_source_anomalies",
      severity: "warning",
      message:
        "The duplex band is internally distinguishable from the other four in three independent ways, which is recorded because it is the same band whose phase scope is uncorroborated. Its size is printed with a Cyrillic м rather than a Latin m and a comma rather than a point decimal separator; its implied FX rate differs from the other four rows; and its size floor matches neither phase. The characters are preserved exactly as extracted and were not transliterated.",
      payload: {
        duplex_size_text: "from 120,9 м2",
        duplex_size_unit_codepoint: "U+043C CYRILLIC SMALL LETTER EM",
        other_bands_size_unit_codepoint: "U+006D LATIN SMALL LETTER M",
        duplex_implied_rate: round2(38230971 / 1215998),
        other_bands_implied_rate: round2(5000000 / 150286),
        source_ref: priceCite(1),
      },
    },
    {
      entity: "price",
      code: "price_band_size_disagreement",
      severity: "warning",
      message:
        "The guide and the price list state different size floors for the same Phase 1 typologies. The differences are small for four of the five bands and are consistent with the guide rounding to whole square metres, but the duplex pair disagrees by nearly twelve square metres and cannot be explained that way. Both figures are preserved per band; neither document was treated as correcting the other.",
      payload: {
        comparisons: LAYAN_PHASE1_SIZE_COMPARISONS,
        guide_source_ref: guideCite("Layout solutions"),
        price_list_source_ref: priceCite(1),
      },
    },
    {
      entity: "price",
      code: "availability_not_ingested",
      severity: "warning",
      message:
        'No availability state was ingested for any typology, because neither source carries a per-unit availability column. The only availability the sources state at all is the word SOLD against Phase 1 duplexes, printed in both documents. That marker is preserved on its band and nowhere else: it is not evidence that any other typology is available, and it must never be rendered as a unit-level or project-level availability figure. Nothing in either current source states a sold percentage for Phase 1 — the guide\'s "Over 60% of apartments sold" belongs to Phase 2, and its Phase 1 "100%" refers to construction completed, not units sold.',
      payload: {
        explicit_sold_states: [
          {
            phase: "Phase 1",
            type_label: "Duplexes",
            stated: "SOLD",
            source_ref: priceCite(1),
          },
          {
            phase: "Phase 1",
            type_label: "DUPLEXES",
            stated: "Sold",
            size_text: "109 m2",
            source_ref: guideCite("Layout solutions"),
          },
        ],
        phase_1_sold_percentage: null,
        not_a_phase_1_figure: {
          "Over 60% of apartments sold": "Phase 2",
          "100% of construction completed": "Phase 1, construction not sales",
        },
      },
    },
    {
      entity: "price",
      code: "investment_claims_not_prices",
      severity: "warning",
      message:
        'The guide carries forward-looking commercial claims — "+100% increase in the value of apartments" for Phase 1, a stated 10-15% value increase with each construction stage, a rental pool distributing 60% of net profit to owners and 40% to the management company, and an instalment plan bearing 3%, 4% and 5% interest across three years. None was ingested. These are vendor projections and commercial terms, not developer prices or yields, and none may ever be rendered as a price, a price range, a yield or a return promise.',
      payload: {
        claims: [
          "+100% increase in the value of apartments (Phase 1)",
          "value of apartments steadily increase by 10-15% with each new construction stage",
          "rental pool: 60% of net profit to owners, 40% to the management company",
          "instalment interest: 3% year one, 4% year two, 5% year three",
          "reservation deposit of THB 200,000",
        ],
        source_refs: [guideCite("investment performance"), guideCite("Project information")],
      },
    },
    {
      entity: "project",
      code: "superseded_source_claims_removed",
      severity: "info",
      message:
        "This record was rebuilt from two current documents that replace the January 2026 agency deck pair the previous version was derived from. Each claim below was carried by the previous payload and is absent from both current sources; each was removed rather than migrated. Absence here means the phrase does not occur in either current document, not that it has been disproved.",
      payload: {
        removed: [
          { claim: "Total units: 377", replaced_by: "Phase 1: 248 apartments" },
          {
            claim: "Units sold: 45% (as of 2026-01)",
            replaced_by: "no Phase 1 sold figure stated",
          },
          {
            claim: "Completion Q1-2026 / construction_status_stale",
            replaced_by: "Phase 1 construction completed in 2024",
          },
          { claim: "distance_to_beach: 700 m", replaced_by: '"two minutes from Layan Beach"' },
          {
            claim: 'project_type "Premium apart-hotel" contradicted by "Condominiums"',
            replaced_by: '"First premium condo-hotel certificated by EDGE"',
          },
          {
            claim: "LA GREEN HOTEL & RESIDENCE named inside Layan Green Park material",
            replaced_by: "no occurrence in either current source",
          },
          {
            claim: 'project_scope_ambiguous — "Layan Green Partk, фаза 2" annex of 28 units',
            replaced_by: "explicit two-phase structure stated by the guide",
          },
          { claim: 'location_area "Layan"', replaced_by: '"Located in Bang Tao"' },
          {
            claim: "five-year investment model with ROI, IRR and an equity multiple",
            replaced_by: "no such model in either current source",
          },
        ],
        superseded_documents: ["Layan Green Park - eng.pdf", "Layan Green Park.pdf"],
        note: 'The "LA GREEN HOTEL & RESIDENCE" residue is resolved as absent, not as merged or aliased. No alias, no merge and no second project record was created, and none should be: the onboarding register\'s separate provisional entry is neither confirmed nor refuted by these two documents.',
      },
    },
    {
      entity: "project",
      code: "stated_facts_not_modelled",
      severity: "info",
      message:
        "Source-stated facts with no column in the current schema were preserved here rather than discarded or forced into an unrelated field. The beach proximity is recorded in the source's own words: the guide states a travel time and never a distance, so no metre figure was derived from it.",
      payload: {
        beach_proximity: "just two minutes from the serene, white-sand Layan Beach",
        beach_proximity_detail: "2 MIN — Layan beach, shuttle to the beach",
        beach_distance_metres: null,
        certification:
          "Phuket’s first eco-friendly development, officially recognized and certified by the international EDGE standard; first premium condo-hotel certificated by EDGE",
        on_site_facilities: "A total of 20,000 sq. m. of on-site facilities",
        amenity_share:
          "over 40% of the project area is dedicated to internal infrastructure; 40% of the development is dedicated to premium amenities",
        travel_times: {
          "Layan beach": "2 MIN",
          "Laguna area, tennis courts, golf courses, spa": "5 MIN",
          "Tesco Lotus and Macros supermarkets, Boat Avenue mall": "15 MIN",
          Airport: "20 MIN",
        },
        payment_options: [
          "100% payment: THB 200,000 reservation deposit, balance within 14 days",
          "Installment plan during construction: THB 200,000 deposit, 35% within 14 days, balance against construction milestones",
          "Post-completion installment plan: THB 200,000 deposit, 35% within 14 days, 35% spread through 2026, remaining 30% over 3 years with interest",
        ],
        project_website: "layangreenpark.com",
        source_refs: [
          guideCite("Overview"),
          guideCite("Infrastructure"),
          guideCite("investment performance"),
        ],
      },
    },
    {
      entity: "project",
      code: "source_ref_section_based",
      severity: "info",
      message:
        "The guide is a single Figma artboard exported as one PDF page, so every citation into it reads page=1 and carries a section label instead. The section labels are the headings the document itself prints. The price list is an ordinary two-page document and is cited by page.",
      payload: {
        guide_producer: "Figma",
        guide_internal_title: "LGP_Guide_ENG",
        guide_pdf_pages: 1,
        price_list_pdf_pages: 2,
        guide_sections_cited: [
          "Overview",
          "Two construction phases",
          "Infrastructure",
          "Layout solutions",
          "investment performance",
          "Project information",
        ],
      },
    },
    {
      entity: "project",
      code: "source_documents_pinned",
      severity: "info",
      message:
        "The two documents this record is built from, pinned by Drive file ID, SHA-256 digest and byte length. Both digests were verified against the bytes read at build time, and every transcribed fact in this payload was asserted back against the text extracted from those same bytes. The Drive file IDs and folder paths come from the Drive listings captured by the preceding audit and were not re-fetched by this task.",
      payload: {
        documents: [
          {
            file: guide.citation,
            role: "Phase 1 project guide",
            drive_file_id: guide.driveFileId,
            drive_parent_folder_id: guide.driveParentFolderId,
            drive_folder_path: guide.driveFolderPath,
            sha256: guide.sha256,
            bytes: guide.bytes,
            producer: "Figma",
            language: "English",
            transcribed_phrases_verified: guidePhrasesVerified,
            material_claims_verified: guideClaimsVerified,
          },
          {
            file: priceList.citation,
            role: "Phase 1 price list",
            drive_file_id: priceList.driveFileId,
            drive_parent_folder_id: priceList.driveParentFolderId,
            drive_folder_path: priceList.driveFolderPath,
            sha256: priceList.sha256,
            bytes: priceList.bytes,
            producer: "iLovePDF",
            language: "English",
            // The document is predominantly English, but not wholly. Recording
            // the exceptions keeps `language` honest and explains why two
            // transcriptions in this payload carry Cyrillic characters.
            language_exceptions: [
              "Page 2 prints a price-validity statement in Russian — see source_date_recorded.",
              "The duplex band's size is printed with a Cyrillic м and a comma decimal separator — see price_band_source_anomalies.",
            ],
            transcribed_phrases_verified: pricePhrasesVerified,
            material_claims_verified: priceClaimsVerified,
          },
        ],
      },
    },
    {
      entity: "media",
      code: "media_not_ingested",
      severity: "info",
      message:
        "Both documents contain embedded imagery only, with no standalone media assets. The price list's second page is a set of floor-plan drawings whose room areas extract as text but which carry no unit identifier. No media row was created and no asset was uploaded or made public.",
      payload: {
        documents: [guide.citation, priceList.citation],
        floor_plan_page: priceCite(2),
      },
    },
    {
      entity: "project",
      field: "source_date",
      code: "source_date_recorded",
      severity: "info",
      message:
        "Both documents state \"valid as of July 1, 2026\" against their prices. That statement dates prices, so it is the source date for price facts only; the four descriptive project fields are undated by their source and say so in their own provenance. The price list's embedded ModDate agrees at 2026-07-01T09:39:17Z, but no file timestamp was used to establish the date. The price list's second page prints a second price-validity statement, in Russian, giving a different date. Both statements are about the validity of prices in the same document and the document does not say which supersedes the other, so the relationship is recorded as unresolved rather than reconciled or reclassified.",
      payload: {
        source_date: "2026-07-01",
        source_date_scope: "price_facts_only",
        stated_as: ["price valid as of July 1, 2026", "Price valid as of July 1, 2026"],
        price_list_moddate_corroboration: "D:20260701093917Z",
        descriptive_fields_source_date: "undated_by_source",
        secondary_stated_validity_date: {
          value: "02.02.2026",
          // Quoted in the source's own characters. The earlier record described
          // this as a "floor-plan page internal date", which the document does
          // not support: the sentence is a price-validity statement, the same
          // kind of statement as the chosen source date. Calling it internal
          // metadata understated a direct conflict.
          stated_as: "Цена актуальна на 02.02.2026",
          stated_in_language: "Russian",
          literal_translation: "price valid as of 02.02.2026",
          kind: "price_validity_statement",
          located_on: priceCite(2),
          relationship_to_source_date: "unresolved",
          note: "The same document states two price-validity dates and does not rank them. Neither was chosen over the other and no supersession was inferred.",
        },
        source_refs: [priceCite(1), guideCite("Layout solutions"), priceCite(2)],
      },
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
        // The additional-cost block sits on page 3, the document's last page.
        // `assertSourceRefPagesWithinBounds` re-checks this against the real
        // page count of the pinned PDF on every build.
        sourcePage: 3,
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
      payload: { source_ref: `${priceList.citation}#page=3` },
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

/**
 * Field names whose values are opaque identifiers: a digest or a Drive file ID.
 * Their characters carry no meaning, so a superseded-claim scan must not read
 * them as text — a pinned digest that happens to contain "377" would otherwise
 * fail the audit for no reason, and digests change whenever a source does.
 */
const OPAQUE_IDENTIFIER_KEYS = new Set([
  "sha256",
  "pinned_sha256",
  "selected_sha256",
  "drive_file_id",
  "drive_parent_folder_id",
]);

/**
 * A `JSON.stringify` replacer that blanks opaque identifiers before a text scan.
 *
 * Masking is decided by **field name**, never by value shape. The earlier
 * shape-based rule (`/^[\w-]{25,45}$/`) matched any 25–45 character word-ish
 * token, so it also hid ordinary warning codes and other plain project text —
 * 21 of the 23 strings it masked were not identifiers at all. That left a real
 * blind spot: a superseded claim carried in a long-enough key or code would
 * have passed the scan unread. Ordinary text and every numeric value now stay
 * visible to the scan; only the five identifier fields are hidden.
 */
function maskOpaqueIdentifiers(key, value) {
  return OPAQUE_IDENTIFIER_KEYS.has(key) && typeof value === "string"
    ? "[opaque-identifier]"
    : value;
}

/**
 * Every `source_ref`-style page citation in a payload, as `{citation, page}`.
 *
 * Two shapes are recognised: a `…#page=N` suffix on a source reference string,
 * and a `source_file`/`source_page` (or camelCase) pair on one object.
 */
function collectSourcePageRefs(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourcePageRefs(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    const citation = value.source_file ?? value.sourceFile;
    const page = value.source_page ?? value.sourcePage;
    if (typeof citation === "string" && typeof page === "number") {
      out.push({ citation, page, via: "field_pair" });
    }
    for (const nested of Object.values(value)) collectSourcePageRefs(nested, out);
    return out;
  }
  if (typeof value === "string") {
    const match = /^(.+?\.pdf)#page=(\d+)/i.exec(value);
    if (match) out.push({ citation: match[1], page: Number(match[2]), via: "source_ref" });
  }
  return out;
}

const pdfPageCountCache = new Map();

/**
 * Page count of a pinned PDF, measured from the document itself via the
 * form-feed separators `pdftotext` emits. Cached per citation: one build cites
 * the same document many times — Sierra alone emits 180 price rows — and the
 * digest pin fixes the bytes for the whole run, so the count cannot change.
 *
 * Returns null for a citation that is not a pinned PDF; there is nothing to
 * bound a page number against in that case.
 */
function pdfPageCount(citation) {
  if (pdfPageCountCache.has(citation)) return pdfPageCountCache.get(citation);
  if (!/\.pdf$/i.test(citation)) return null;
  const key = Object.keys(SOURCES).find((name) => SOURCES[name].citation === citation);
  if (!key) return null;
  const pages = pdfToLayoutText(requireSource(key).path).split("\f");
  while (pages.length && pages[pages.length - 1].trim() === "") pages.pop();
  const count = pages.length;
  pdfPageCountCache.set(citation, count);
  return count;
}

/**
 * No citation may point past the end of the document it cites.
 *
 * A record whose whole value is "every fact traces to a citation" is undermined
 * by a locator that resolves to nothing, and a hard-coded page number cannot
 * notice that the document it points into has been re-paginated. The bound is
 * therefore measured from the pinned bytes on every build rather than asserted
 * once by hand.
 *
 * `countPages` is injectable so this can be tested without a PDF present.
 */
function auditSourceRefPagesWithinBounds(slug, payload, countPages = pdfPageCount) {
  let checked = 0;
  for (const ref of collectSourcePageRefs(payload)) {
    const pages = countPages(ref.citation);
    if (pages === null || pages === undefined) continue;
    if (!Number.isInteger(ref.page) || ref.page < 1 || ref.page > pages) {
      throw new Error(
        `source_ref_page_out_of_bounds: ${slug} cites page ${ref.page} of ${ref.citation}, ` +
          `which has ${pages} page(s).`,
      );
    }
    checked++;
  }
  console.log(`AUDIT ${slug}: ${checked} source page citation(s) within document bounds`);
  return checked;
}

/** Two warnings may never share a code: the second would be unaddressable. */
function auditWarningCodesUnique(slug, payload) {
  const seen = new Set();
  for (const warning of payload.warnings ?? []) {
    if (seen.has(warning.code)) {
      throw new Error(`duplicate_warning_code: ${slug} repeats ${warning.code}.`);
    }
    seen.add(warning.code);
  }
  return seen.size;
}

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
 * A deck-derived Passport Light record must stay project-only. The deck states
 * building and unit counts but no identifiers, so materialising any row here
 * would be invention. Regression guard for AYANA.
 *
 * Layan was covered by this guard while it was deck-derived. It is not any more,
 * because its evidence class changed: it now has a real price list, so
 * `price_list_missing` and `investment_projections_not_prices` are no longer
 * true of it and requiring them would force the payload to carry two false
 * warnings. Layan is guarded by `auditLayanPhase1` instead, which checks strictly
 * more than this function does. Nothing was relaxed for AYANA.
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

/**
 * Layan Phase 1. Replaces `auditDeckOnly` for this project and checks strictly
 * more: the same no-invented-rows rule, plus the three things that could quietly
 * undo this rebuild — a stale deck claim creeping back, a Phase 2 figure being
 * ingested as Phase 1, and a type-level band being promoted into a unit.
 *
 * Gate G9 as originally written required a `construction_status_stale` warning,
 * because the deck's completion quarter had already lapsed. That premise is gone:
 * Phase 1 is stated complete, so the correct assertion is the inverse — the
 * lapsed-quarter claim must NOT be present. The gate's intent, that a lapsed
 * readiness state never reads as current, is enforced more directly here.
 */
function auditLayanPhase1(payload) {
  for (const collection of ["buildings", "units", "prices", "media", "documents"]) {
    const rows = payload[collection] ?? [];
    if (rows.length) {
      throw new Error(
        `layan_record_violation: ${rows.length} ${collection} row(s) emitted. Neither current ` +
          `source carries a per-unit or per-building identifier, so any row here is invention.`,
      );
    }
  }

  const codes = new Set((payload.warnings ?? []).map((warning) => warning.code));
  for (const required of [
    "phase_scope_phase_1_only",
    "phase_2_sources_not_ingested",
    "building_inventory_missing",
    "unit_inventory_missing",
    "price_bands_type_level_only",
    "price_fx_inconsistent",
    "price_band_phase_scope_derived",
    "availability_not_ingested",
    "investment_claims_not_prices",
    "developer_unresolved",
    "source_documents_pinned",
  ]) {
    if (!codes.has(required)) throw new Error(`layan_warning_missing: ${required}`);
  }

  // Superseded claims must not reappear under their old codes.
  for (const forbidden of [
    "construction_status_stale",
    "completion_quarter_only",
    "units_sold_snapshot",
    "project_scope_ambiguous",
    "related_project_name_in_source",
    "project_type_inconsistent",
    "price_list_missing",
    "unit_types_missing",
    "country_missing",
  ]) {
    if (codes.has(forbidden)) {
      throw new Error(
        `layan_superseded_warning_present: ${forbidden} has no basis in the current sources.`,
      );
    }
  }

  // Nor under any other code. `superseded_source_claims_removed` documents these
  // strings deliberately, so it is the one warning exempt from the scan.
  const scanned = JSON.stringify(
    (payload.warnings ?? []).filter(
      (warning) => warning.code !== "superseded_source_claims_removed",
    ),
    maskOpaqueIdentifiers,
  );
  for (const [needle, why] of [
    ["377", "the superseded 377-unit total"],
    ["45%", "the superseded 45%-sold snapshot"],
    ["Q1-2026", "the superseded lapsed completion quarter"],
    ["700 m", "the superseded 700 m beach distance"],
    ["LA GREEN", "the superseded LA GREEN HOTEL & RESIDENCE residue"],
    ["apart-hotel", "the superseded apart-hotel property type"],
  ]) {
    if (scanned.includes(needle)) {
      throw new Error(`layan_superseded_claim_present: ${why} (${needle}) reached the payload.`);
    }
  }

  // A Phase 2 figure must never be ingested as a Phase 1 value. Three warnings
  // exist precisely to explain how the two phases were told apart, and cannot do
  // that without naming Phase 2 figures; the check is that no other warning does.
  const phaseBoundaryWarnings = new Set([
    "phase_scope_phase_1_only",
    "phase_2_sources_not_ingested",
    "price_band_phase_scope_derived",
  ]);
  for (const warning of payload.warnings ?? []) {
    if (phaseBoundaryWarnings.has(warning.code)) continue;
    const text = JSON.stringify(warning);
    for (const phase2Figure of ["296", "16 673", "37 m² - 269 m²"]) {
      if (text.includes(phase2Figure)) {
        throw new Error(
          `layan_phase_2_leak: warning ${warning.code} carries the Phase 2 figure ${phase2Figure}.`,
        );
      }
    }
  }

  // Type-level bands must stay type-level: no band may carry a unit identifier.
  const bandWarning = (payload.warnings ?? []).find(
    (warning) => warning.code === "price_bands_type_level_only",
  );
  const bands = bandWarning?.payload?.bands ?? [];
  if (!bands.length) throw new Error("layan_price_bands_empty: the price list produced no band.");
  for (const band of bands) {
    for (const forbiddenKey of ["unit_code", "unit_id", "room", "availability_status", "floor"]) {
      if (forbiddenKey in band) {
        throw new Error(
          `layan_band_is_not_a_unit: band ${band.type_label} carries ${forbiddenKey}; ` +
            `a type-level price band must never be shaped like a unit.`,
        );
      }
    }
  }

  console.log(
    `AUDIT layan-green-park: Phase 1 only, ${bands.length} type-level price bands, ` +
      `0 invented rows, ${(payload.warnings ?? []).length} warnings`,
  );
}

const BUILDERS = {
  "rainpalm-villas": buildRainpalm,
  "garden-of-eden": buildGardenOfEden,
  "the-title-sierra": buildSierra,
  "layan-green-park": buildLayanGreenPark,
  "ayana-heights-seaview-residence": buildAyanaHeights,
};

/** Build, audit and emit. Runs only when this file is the entry point. */
function main() {
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
    auditWarningCodesUnique(slug, payload);
    auditSourceRefPagesWithinBounds(slug, payload);
  }
  if (built["rainpalm-villas"]) auditRainpalm(built["rainpalm-villas"]);
  if (built["the-title-sierra"]) auditSierra(built["the-title-sierra"]);
  if (built["garden-of-eden"]) {
    console.log("AUDIT garden-of-eden: owner_provided provenance, no invented facts");
  }
  for (const slug of ["ayana-heights-seaview-residence"]) {
    if (built[slug]) auditDeckOnly(slug, built[slug]);
  }
  if (built["layan-green-park"]) auditLayanPhase1(built["layan-green-park"]);

  for (const notice of softNotices) {
    console.log(
      `NOTICE ${notice.code}: ${notice.file} (pinned ${notice.pinned_sha256.slice(0, 12)}… selected ${notice.selected_sha256.slice(0, 12)}…)`,
    );
  }
  return built;
}

// The build runs on invocation, not on import, so the pure helpers and audit
// functions above can be unit-tested without writing a payload or needing an
// Owner source root. Nothing else about the script's behaviour changes.
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();

export {
  assertMaterialClaims,
  assertTranscribedFacts,
  auditDeckOnly,
  auditDraftOnly,
  auditLayanPhase1,
  auditNoDuplicateUnits,
  auditNumericsParsed,
  auditRainpalm,
  auditSierra,
  auditSourceRefPagesWithinBounds,
  auditWarningCodesUnique,
  BUILDERS,
  collectSourcePageRefs,
  countOccurrences,
  fingerprintBatch,
  LAYAN_PHASE1_GUIDE_BANDS,
  LAYAN_PHASE1_GUIDE_MATERIAL_CLAIMS,
  LAYAN_PHASE1_PRICE_BANDS,
  LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS,
  LAYAN_PHASE1_SIZE_COMPARISONS,
  main,
  maskOpaqueIdentifiers,
  normalizeExtractedText,
  OPAQUE_IDENTIFIER_KEYS,
  parseSierraRows,
  provenance,
  round2,
  round4,
  rowSource,
  selectPinnedCandidate,
  SOURCES,
  spaceGrouped,
  stableStringify,
};
