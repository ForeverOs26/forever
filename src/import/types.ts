import type { Json } from "@/integrations/supabase/types";
import type {
  BuildingInput,
  DeveloperRecord,
  LocationRecord,
  PriceHistoryInput,
  ProjectRecord,
  UnitInput,
} from "./database";
import type { ForeverManifest } from "./manifest";
import type { ProjectValidationReport, ValidationIssue } from "./validator";
import type { CurrencyDecision } from "./currency-policy";

export type ImportMode = "dry-run" | "execute";

export type ImportState =
  | "initialized"
  | "manifest_loaded"
  | "datasets_loaded"
  | "package_validated"
  | "plan_created"
  | "relationships_validated"
  | "dry_run_completed"
  | "executing"
  | "blocked"
  | "completed"
  | "rolling_back"
  | "rolled_back"
  | "failed";

export type ImportEntityType =
  | "developer"
  | "location"
  | "project"
  | "building"
  | "unit"
  | "unit_price_history";

export type ImportOperationAction = "upsert" | "insert" | "update" | "skip";

export interface ImportOperation<TPayload = unknown> {
  entity: ImportEntityType;
  action: ImportOperationAction;
  naturalKey: string;
  payload: TPayload;
  dependsOn?: ImportEntityType[];
}

export interface ExtractedDatasets {
  brochure: unknown | null;
  priceList: ExtractedPriceList | null;
  masterplan: unknown | null;
  unitPlans: unknown | null;
  images: unknown | null;
  documents: unknown | null;
}

export interface Fact<T = unknown> {
  value: T | null;
  raw_value?: unknown;
  source_file?: string | null;
  page_number?: number | null;
  sheet_name?: string | null;
  confidence?: string;
  status?: "source_verified" | "inferred_default" | "unresolved" | "conflict";
}

export interface ExtractedPriceListRow {
  source_row?: number;
  unit_number?: Fact<string>;
  unit_code?: Fact<string>;
  building?: Fact<string>;
  floor?: Fact<string | number>;
  unit_type?: Fact<string>;
  bedrooms?: Fact<string | number>;
  bathrooms?: Fact<string | number>;
  size_sqm?: Fact<string | number>;
  price?: Fact<string | number>;
  currency?: Fact<string>;
  price_per_sqm?: Fact<string | number>;
  availability_status?: Fact<string>;
  payment_terms?: Fact<string>;
  promotion_discount_notes?: Fact<string>;
}

export interface ExtractedPriceList {
  price_list_date?: Fact<string>;
  currency_decision?: CurrencyDecision;
  unit_inventory?: ExtractedPriceListRow[];
}

export interface ExtractedUnitPlanRow {
  source_row?: number;
  unit_number?: Fact<string> | string;
  unit_code?: Fact<string> | string;
  building?: Fact<string> | string;
  floor?: Fact<string | number> | string | number;
  unit_type?: Fact<string> | string;
  bedrooms?: Fact<string | number> | string | number;
  bathrooms?: Fact<string | number> | string | number;
  size_sqm?: Fact<string | number> | string | number;
  availability_status?: Fact<string> | string;
  source_file?: string;
  source_reference?: {
    source_file?: string;
    page_number?: number | null;
    confidence?: string;
  };
}

export interface ExtractedUnitPlans {
  unit_inventory?: ExtractedUnitPlanRow[];
  units?: ExtractedUnitPlanRow[];
}

export interface ImportPlan {
  projectSlug: string;
  mode: ImportMode;
  manifest: ForeverManifest;
  validation: ProjectValidationReport;
  datasets: ExtractedDatasets;
  canonicalProject: CanonicalProject;
  projectFacts: Record<string, Json>;
  developer: Record<string, unknown>;
  location: Record<string, unknown>;
  project: Record<string, unknown>;
  buildings: BuildingInput[];
  units: UnitInput[];
  priceHistoryRows: PriceHistoryInput[];
  operations: ImportOperation[];
  rollback: RollbackPlan;
}

export interface RollbackStep {
  entity: ImportEntityType;
  naturalKey: string;
  strategy: "restore_previous" | "delete_inserted" | "no_op";
  reason: string;
}

export interface RollbackPlan {
  supported: boolean;
  strategy: "transaction" | "compensating_actions" | "not_required";
  steps: RollbackStep[];
  notes: string[];
}

export interface ImportExecutionContext {
  state: ImportState;
  mode: ImportMode;
  projectSlug: string;
  startedAt: string;
  updatedAt: string;
  errors: ValidationIssue[];
}

export interface ImportExecutionResult {
  developer?: DeveloperRecord;
  location?: LocationRecord;
  project?: ProjectRecord;
  buildingIds?: Map<string, string>;
  unitIds?: Map<string, string>;
  priceCount?: number;
}

export interface CanonicalProject {
  name: string;
  slug: string;
  developer: string;
  country: string;
  province: string;
  locationArea: string;
  projectType: string;
  publicStatus: string | null;
  salesStatus: string | null;
  sourceVersion: string;
  importManifest: {
    manifestFormat: string;
    manifestVersion: string;
    createdAt: string;
    projectSlug: string;
  };
  importReadiness: {
    ready: boolean;
    importStatusReady: boolean;
    validationIssueCount: number;
  };
  optional: {
    projectCode: string | null;
    address: string | null;
    shortDescription: string | null;
    fullDescription: string | null;
    constructionStatus: string | null;
    completionDate: string | null;
    ownershipType: string | null;
    distanceToBeach: string | null;
    distanceToAirport: string | null;
    latitude: number | null;
    longitude: number | null;
    mainImage: string | null;
    brochureUrl: string | null;
    startingPrice: number | null;
    priceRange: string | null;
    verifiedPriceLabel: string | null;
    lastPriceUpdate: string | null;
    lastInspectionDate: string | null;
    trustNote: string | null;
    marketPosition: string | null;
    verdict: string | null;
    highlights: string[];
  };
}
