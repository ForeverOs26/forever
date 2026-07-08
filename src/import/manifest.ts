import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type AssetReadinessLevel = "required" | "recommended" | "optional";
export type AssetStatus = "available" | "pending" | "missing content" | "missing";

export interface ForeverManifestAsset {
  asset_type: string;
  readiness_level?: AssetReadinessLevel;
  folder: string;
  supported_extensions: string[];
  multiple_files: boolean;
  required: boolean;
  status: AssetStatus | string;
}

export interface ForeverManifest {
  manifest_format: string;
  manifest_version: string;
  project_name: string;
  project_slug: string;
  developer: string;
  project_type: string;
  country: string;
  province: string;
  location: string;
  source_version: string;
  created_at: string;
  readiness_policy?: {
    required?: string[];
    recommended?: string[];
    optional?: string[];
    ready_for_import_rule?: string;
  };
  assets: ForeverManifestAsset[];
}

export const FOREVER_PROJECTS_ROOT = "forever-data/projects";
export const SUPPORTED_MANIFEST_VERSIONS = ["1.0", "1.1", "1.2"];

export function getProjectRoot(projectSlug: string, projectsRoot = FOREVER_PROJECTS_ROOT) {
  return join(projectsRoot, projectSlug);
}

export function getManifestPath(projectSlug: string, projectsRoot = FOREVER_PROJECTS_ROOT) {
  return join(getProjectRoot(projectSlug, projectsRoot), "manifest.json");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid manifest: ${field} is required.`);
  }
}

function assertAsset(value: unknown, index: number): asserts value is ForeverManifestAsset {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid manifest: assets[${index}] must be an object.`);
  }

  const asset = value as Partial<ForeverManifestAsset>;
  assertString(asset.asset_type, `assets[${index}].asset_type`);
  assertString(asset.folder, `assets[${index}].folder`);

  if (!Array.isArray(asset.supported_extensions)) {
    throw new Error(`Invalid manifest: assets[${index}].supported_extensions must be an array.`);
  }

  if (typeof asset.multiple_files !== "boolean") {
    throw new Error(`Invalid manifest: assets[${index}].multiple_files must be boolean.`);
  }

  if (typeof asset.required !== "boolean") {
    throw new Error(`Invalid manifest: assets[${index}].required must be boolean.`);
  }
}

export function validateManifestShape(value: unknown): ForeverManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid manifest: expected an object.");
  }

  const manifest = value as Partial<ForeverManifest>;
  assertString(manifest.manifest_format, "manifest_format");
  assertString(manifest.manifest_version, "manifest_version");
  assertString(manifest.project_name, "project_name");
  assertString(manifest.project_slug, "project_slug");
  assertString(manifest.developer, "developer");
  assertString(manifest.project_type, "project_type");
  assertString(manifest.country, "country");
  assertString(manifest.province, "province");
  assertString(manifest.location, "location");
  assertString(manifest.source_version, "source_version");
  assertString(manifest.created_at, "created_at");

  if (manifest.manifest_format !== "forever_project_import_manifest") {
    throw new Error(`Invalid manifest_format: ${manifest.manifest_format}`);
  }

  if (!SUPPORTED_MANIFEST_VERSIONS.includes(manifest.manifest_version)) {
    throw new Error(`Unsupported manifest_version: ${manifest.manifest_version}`);
  }

  if (!Array.isArray(manifest.assets)) {
    throw new Error("Invalid manifest: assets must be an array.");
  }

  manifest.assets.forEach(assertAsset);

  return manifest as ForeverManifest;
}

export async function loadManifest(projectSlug: string, projectsRoot = FOREVER_PROJECTS_ROOT) {
  const manifestPath = getManifestPath(projectSlug, projectsRoot);
  const raw = await readFile(manifestPath, "utf-8");
  return validateManifestShape(JSON.parse(raw));
}
