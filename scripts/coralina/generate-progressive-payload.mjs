import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const sourcePath = resolve(root, "forever-data/projects/coralina/extracted/price-list.json");
const reviewPath = resolve(root, "forever-data/projects/coralina/evidence/rc5-4-evidence-review.json");
const outputPath = resolve(root, "forever-data/projects/coralina/progressive/payload.json");
const validationPath = resolve(root, "forever-data/projects/coralina/progressive/validation-summary.json");

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

const fact = (value) => (value?.confidence !== "none" && value?.value != null ? value.value : null);
const numberFact = (value) => {
  const parsed = Number(String(fact(value)).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const provenance = (sourceRef, sourceDate, confidence = 1) => ({
  status: "official_source",
  source_type: "official_project_material",
  source_ref: sourceRef,
  ...(sourceDate ? { source_date: sourceDate } : {}),
  confidence,
});

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const review = JSON.parse(await readFile(reviewPath, "utf8"));
const identity = Object.fromEntries(
  review.unified_evidence_table.map((item) => [item.field, item]),
);
const rows = source.unit_inventory;
const priceListDate = fact(source.price_list_date);

const buildings = [...new Set(rows.map((row) => String(fact(row.building)).trim()))]
  .sort()
  .map((building_code) => ({
    building_code,
    metadata: {
      field_provenance: {
        building_code: provenance(rows.find((row) => fact(row.building) === building_code).building.source_file, priceListDate),
      },
    },
  }));

const units = rows.map((row) => {
  const sourceRef = row.unit_number.source_file;
  const sourcePage = row.unit_number.page_number;
  return {
    unit_code: String(fact(row.unit_number)),
    building_code: String(fact(row.building)),
    unit_type: String(fact(row.unit_type)),
    bedrooms: numberFact(row.bedrooms),
    size_sqm: numberFact(row.size_sqm),
    floor: numberFact(row.floor),
    availability_status: String(fact(row.availability_status)).trim().toLowerCase(),
    metadata: {
      source_unit_type_code: fact(row.unit_code),
      source_row: row.source_row,
      source_page: sourcePage,
      field_provenance: {
        unit_code: provenance(sourceRef, priceListDate),
        building_code: provenance(row.building.source_file, priceListDate),
        unit_type: provenance(row.unit_type.source_file, priceListDate),
        bedrooms: provenance(row.bedrooms.source_file, priceListDate, 0.7),
        size_sqm: provenance(row.size_sqm.source_file, priceListDate),
        floor: provenance(row.floor.source_file, priceListDate),
        availability_status: provenance(row.availability_status.source_file, priceListDate),
      },
    },
  };
});

const prices = rows.map((row) => ({
  unit_code: String(fact(row.unit_number)),
  price: numberFact(row.price),
  currency: "THB",
  price_source: "developer_price_list",
  source_file: row.price.source_file,
  source_page: row.price.page_number,
  price_list_date: priceListDate,
  metadata: {
    source_row: row.source_row,
    source_price_per_sqm: fact(row.price_per_sqm),
    currency_decision: {
      value: "THB",
      status: "inferred_default",
      confidence: "medium",
      inferenceRule: "project_country_default_currency",
      inferenceRuleVersion: "1.0.0",
      inferredFromCountry: "Thailand",
      priceEvidence: [{ value: null, status: "unresolved", confidence: "none", sourceFile: row.currency.source_file, sourcePage: row.currency.page_number }],
      countryEvidence: { value: "Thailand", status: "source_verified", confidence: "high", sourceFile: identity.location.source_urls[1], context: "project country" },
      reviewFindings: [],
    },
    field_provenance: {
      price: { status: "extracted", source_type: "official_project_price_list", source_ref: row.price.source_file, source_date: priceListDate, confidence: 1 },
      currency: { status: "inferred", confidence: 0.7, reasoning: { rule: "project_country_default_currency", rule_version: "1.0.0", status: "inferred_default", confidence: "medium", inferred_from_country: "Thailand" } },
    },
  },
}));

const warnings = [
  { entity: "developer", code: "developer_unresolved", severity: "warning", message: "No repository evidence proves an exact existing production developer UUID; raw developer identity is preserved and developer_id remains NULL.", payload: { raw_name: "Rhom Bho Property Public Company Limited" } },
  { entity: "location", code: "location_unresolved", severity: "warning", message: "No repository evidence proves an exact existing production location UUID; raw location identity is preserved and location_id remains NULL.", payload: { raw_name: "Kamala, Phuket, Thailand" } },
  { entity: "project", field: "latitude", code: "coordinates_missing", severity: "warning", message: "No source-backed Coralina latitude/longitude was found; coordinates remain NULL." },
  { entity: "project", field: "construction_status", code: "construction_status_missing", severity: "warning", message: "No source-backed Coralina construction status or completion date was found; these fields remain NULL." },
  { entity: "media", code: "media_processing_deferred", severity: "info", message: "Repository-local media has no stable storage URL supported by the RPC; media ingestion is deferred." },
  { entity: "document", code: "document_processing_deferred", severity: "info", message: "Repository-local documents have no stable storage URL supported by the RPC; document ingestion is deferred." },
];

const body = {
  schema_version: "1",
  mode: "create",
  project: {
    slug: "coralina",
    name: "The Title Coralina Kamala",
    developer_id: null,
    location_id: null,
    developer_name_raw: "Rhom Bho Property Public Company Limited",
    location_name_raw: "Kamala, Phuket, Thailand",
    location_area: "Kamala",
    project_type: "Residential",
    publish: false,
    field_provenance: {
      name: { status: "official_source", source_type: "official_developer_website", source_ref: identity.official_project_name.source_urls[0], confidence: 1 },
      developer_name_raw: { status: "official_source", source_type: "government_filing", source_ref: identity.developer.source_urls[1], source_date: "2026-05-06", confidence: 1 },
      location_name_raw: { status: "official_source", source_type: "government_filing", source_ref: identity.location.source_urls[1], source_date: "2026-05-06", confidence: 1 },
      location_area: provenance("forever-data/projects/coralina/source/brochure/2. E-Brochure__20251209 Coralina E-brochure.pdf", undefined),
      project_type: provenance("forever-data/projects/coralina/source/documents/3. Facilities__Coralina Facilities.pdf", undefined, 0.7),
    },
  },
  buildings,
  units,
  prices,
  warnings,
};

const batch = { ...body, batch_fingerprint: createHash("sha256").update(stableStringify(body), "utf8").digest("hex") };
const unitCodes = new Set(units.map((unit) => unit.unit_code));
const buildingCodes = new Set(buildings.map((building) => building.building_code));
const validations = {
  source_rows_equal_units: rows.length === units.length,
  source_rows_equal_prices: rows.length === prices.length,
  unique_unit_codes: unitCodes.size === units.length,
  unique_building_codes: buildingCodes.size === buildings.length,
  all_units_have_buildings: units.every((unit) => buildingCodes.has(unit.building_code)),
  all_prices_have_units: prices.every((price) => unitCodes.has(price.unit_code)),
  all_prices_numeric: prices.every((price) => Number.isFinite(price.price)),
  all_prices_inferred_thb: prices.every((price) => price.currency === "THB" && price.metadata.currency_decision.status === "inferred_default"),
  canonical_ids_null: batch.project.developer_id === null && batch.project.location_id === null,
  draft_nonpublished_intent: batch.project.publish === false,
};
if (Object.values(validations).some((value) => value !== true)) throw new Error(JSON.stringify(validations));

const summary = {
  schema_version: "1",
  payload: "forever-data/projects/coralina/progressive/payload.json",
  batch_fingerprint: batch.batch_fingerprint,
  counts: { projects: 1, buildings: buildings.length, units: units.length, prices: prices.length, media: 0, documents: 0, warnings: warnings.length, ingestion_batches: 1 },
  expected_database_delta: { projects: 1, buildings: buildings.length, units: units.length, unit_price_history: prices.length, project_media: 0, documents: 0, ingestion_warnings: warnings.length, ingestion_batches: 1 },
  validations,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
await writeFile(validationPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
