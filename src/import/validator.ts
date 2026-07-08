import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForeverManifest, ForeverManifestAsset } from "./manifest";
import { getProjectRoot, SUPPORTED_MANIFEST_VERSIONS } from "./manifest";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface ExtractedFilesStatus {
  brochure: boolean;
  priceList: boolean;
}

export interface ProjectValidationReport {
  projectSlug: string;
  ready: boolean;
  manifestVersionValid: boolean;
  importStatusReady: boolean;
  requiredFoldersValid: boolean;
  requiredFilesValid: boolean;
  extractedJsonValid: boolean;
  issues: ValidationIssue[];
  extracted: ExtractedFilesStatus;
}

const REQUIRED_MANIFEST_METADATA: Array<keyof ForeverManifest> = [
  "project_name",
  "project_slug",
  "developer",
  "project_type",
  "country",
  "province",
  "location",
  "source_version",
];

interface ImportStatusFolder {
  asset_type?: string;
  folder?: string;
  exists?: boolean;
  status?: string;
  supported_file_count?: number;
}

interface ImportStatus {
  ready_for_import?: boolean;
  folders_found?: ImportStatusFolder[];
  missing_required_folders?: string[];
  missing_required_files?: string[];
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  if (!(await pathExists(path))) return null;
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

function isRequired(asset: ForeverManifestAsset) {
  return asset.required || asset.readiness_level === "required";
}

function isPlaceholder(value: unknown) {
  return typeof value === "string" && value.trim().toUpperCase() === "SOURCE_PENDING";
}

async function listSupportedFiles(folderPath: string, extensions: string[]) {
  if (!(await pathExists(folderPath))) return [];
  const files = await readdir(folderPath, { withFileTypes: true });
  const supported = new Set(extensions.map((extension) => extension.toLowerCase()));

  return files
    .filter((file) => file.isFile())
    .map((file) => file.name)
    .filter((name) => supported.has(name.slice(name.lastIndexOf(".")).toLowerCase()));
}

export async function validateProjectImport(
  manifest: ForeverManifest,
  projectsRoot = "forever-data/projects",
): Promise<ProjectValidationReport> {
  const projectRoot = getProjectRoot(manifest.project_slug, projectsRoot);
  const importStatusPath = join(projectRoot, "import-status.json");
  const extractedRoot = join(projectRoot, "extracted");
  const issues: ValidationIssue[] = [];
  const importStatus = await readJsonFile<ImportStatus>(importStatusPath);

  const manifestVersionValid = SUPPORTED_MANIFEST_VERSIONS.includes(manifest.manifest_version);
  if (!manifestVersionValid) {
    issues.push({
      severity: "error",
      code: "manifest_version_unsupported",
      message: `Unsupported manifest version: ${manifest.manifest_version}`,
      path: join(projectRoot, "manifest.json"),
    });
  }

  for (const field of REQUIRED_MANIFEST_METADATA) {
    const value = manifest[field];
    if (isPlaceholder(value)) {
      issues.push({
        severity: "error",
        code: "manifest_metadata_source_pending",
        message: `Required manifest metadata ${field} is still SOURCE_PENDING.`,
        path: join(projectRoot, "manifest.json"),
      });
    }
  }

  if (!importStatus) {
    issues.push({
      severity: "error",
      code: "import_status_missing",
      message: "import-status.json is missing.",
      path: importStatusPath,
    });
  }

  const importStatusReady = importStatus?.ready_for_import === true;
  if (importStatus && !importStatusReady) {
    issues.push({
      severity: "error",
      code: "import_status_not_ready",
      message: "import-status.json does not mark the project ready for import.",
      path: importStatusPath,
    });
  }

  let requiredFoldersValid = true;
  let requiredFilesValid = true;

  for (const asset of manifest.assets.filter(isRequired)) {
    const folderPath = join(projectRoot, asset.folder);
    const exists = await pathExists(folderPath);

    if (!exists) {
      requiredFoldersValid = false;
      issues.push({
        severity: "error",
        code: "required_folder_missing",
        message: `Required folder is missing for ${asset.asset_type}.`,
        path: folderPath,
      });
      continue;
    }

    const supportedFiles = await listSupportedFiles(folderPath, asset.supported_extensions);
    if (supportedFiles.length === 0) {
      requiredFilesValid = false;
      issues.push({
        severity: "error",
        code: "required_files_missing",
        message: `Required folder has no supported files for ${asset.asset_type}.`,
        path: folderPath,
      });
    }
  }

  const brochurePath = join(extractedRoot, "brochure.json");
  const priceListPath = join(extractedRoot, "price-list.json");
  const brochure = await readJsonFile<unknown>(brochurePath);
  const priceList = await readJsonFile<unknown>(priceListPath);
  const extracted = {
    brochure: Boolean(brochure),
    priceList: Boolean(priceList),
  };

  if (!extracted.brochure) {
    issues.push({
      severity: "warning",
      code: "brochure_extraction_missing",
      message:
        "extracted/brochure.json is missing. Project import can continue, but project facts may be sparse.",
      path: brochurePath,
    });
  }

  if (!extracted.priceList) {
    issues.push({
      severity: "warning",
      code: "price_list_extraction_missing",
      message: "extracted/price-list.json is missing. Unit and price import will be skipped.",
      path: priceListPath,
    });
  }

  const extractedJsonValid = extracted.brochure || extracted.priceList;
  if (!extractedJsonValid) {
    issues.push({
      severity: "error",
      code: "extracted_json_missing",
      message: "No supported extracted JSON files are available.",
      path: extractedRoot,
    });
  }

  const ready =
    manifestVersionValid &&
    importStatusReady &&
    requiredFoldersValid &&
    requiredFilesValid &&
    extractedJsonValid &&
    !issues.some((issue) => issue.severity === "error");

  return {
    projectSlug: manifest.project_slug,
    ready,
    manifestVersionValid,
    importStatusReady,
    requiredFoldersValid,
    requiredFilesValid,
    extractedJsonValid,
    issues,
    extracted,
  };
}
