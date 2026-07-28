/**
 * The read-only picture of production the plan is built against
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Planning and writing are separated by a file on purpose. The plan has to be
 * reviewed by a human before anything is written, and a reviewer cannot review
 * a query — only its result. So the target is read once, written down, and the
 * planner is a pure function of that record.
 *
 * What the snapshot deliberately does NOT contain:
 *
 *   `metadata` — the column carrying source paths, package directories and
 *   sanitizer records, and the reason `20260723130000_public_projection_privacy`
 *   exists. It is never selected, so it can never leak into a manifest, a report
 *   or a research directory. That also means the manifest cannot predict the
 *   `project_media` non-role digest, which is stated as `null` rather than
 *   guessed.
 *
 *   `title` — same reasoning, lower stakes. Six production rows carry the
 *   literal string "Cover" and nothing else carries anything.
 *
 * Parsing accepts both the snake_case JSON the capture runner writes and the
 * camelCase form used in memory, because the pg harness builds snapshots
 * directly and should not have to spell them the long way.
 */

import { SNAPSHOT_SCHEMA_VERSION } from "./types";
import type {
  BusinessBaseline,
  ProductionSnapshot,
  SnapshotMediaRow,
  SnapshotProject,
} from "./types";

export { SNAPSHOT_SCHEMA_VERSION };

export class SnapshotError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SnapshotError";
    this.code = code;
  }
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SnapshotError("snapshot_shape", `${what} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

/** Read a field under either spelling. Snapshots on disk are snake_case. */
function pick(source: Record<string, unknown>, snake: string, camel: string): unknown {
  return source[snake] !== undefined ? source[snake] : source[camel];
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string")
    throw new SnapshotError("snapshot_shape", `${what} must be a string.`);
  return value;
}

function asOptionalString(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return asString(value, what);
}

function asInteger(value: unknown, what: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new SnapshotError("snapshot_shape", `${what} must be an integer.`);
  }
  return n;
}

function asBoolean(value: unknown, what: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "t") return true;
  if (value === "false" || value === "f") return false;
  throw new SnapshotError("snapshot_shape", `${what} must be a boolean.`);
}

function parseBaseline(value: unknown): BusinessBaseline {
  if (value === undefined || value === null) return { capturedBy: "unavailable", projects: [] };
  const source = asObject(value, "business_baseline");
  const capturedBy = asString(
    pick(source, "captured_by", "capturedBy"),
    "business_baseline.captured_by",
  );
  if (
    capturedBy !== "head_count_exact" &&
    capturedBy !== "psql_count" &&
    capturedBy !== "unavailable"
  ) {
    throw new SnapshotError(
      "snapshot_shape",
      `business_baseline.captured_by must be head_count_exact, psql_count or unavailable.`,
    );
  }
  const rawProjects = pick(source, "projects", "projects");
  const projects = Array.isArray(rawProjects) ? rawProjects : [];
  return {
    capturedBy,
    projects: projects.map((entry) => {
      const p = asObject(entry, "business_baseline.projects[]");
      return {
        projectId: asString(pick(p, "project_id", "projectId"), "business_baseline project_id"),
        units: asInteger(p.units, "business_baseline units"),
        unitsSold: asInteger(pick(p, "units_sold", "unitsSold"), "business_baseline units_sold"),
        unitPriceHistoryRows: asInteger(
          pick(p, "unit_price_history_rows", "unitPriceHistoryRows"),
          "business_baseline unit_price_history_rows",
        ),
        buildings: asInteger(p.buildings, "business_baseline buildings"),
      };
    }),
  };
}

/**
 * Parse and validate a snapshot file.
 *
 * Throws rather than repairing. A snapshot that does not say what schema it is,
 * or does not say which database it came from, cannot be reasoned about — and
 * the whole point of the file is that the plan is provably about one specific
 * target.
 */
export function parseProductionSnapshot(json: unknown): ProductionSnapshot {
  const source = asObject(json, "The snapshot");
  const schemaVersion = asString(pick(source, "schema_version", "schemaVersion"), "schema_version");
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotError(
      "snapshot_schema_version",
      `Snapshot schema_version is "${schemaVersion}"; this build reads only ` +
        `"${SNAPSHOT_SCHEMA_VERSION}". Re-capture rather than hand-editing: the fields ` +
        `differ in ways a rename cannot fix.`,
    );
  }
  const projectRef = asString(pick(source, "project_ref", "projectRef"), "project_ref");
  if (!projectRef.trim()) {
    throw new SnapshotError(
      "snapshot_project_ref_missing",
      "The snapshot names no project_ref, so nothing can prove which database it describes.",
    );
  }
  const sourceKind = asString(source.source, "source");
  if (sourceKind !== "postgrest_get" && sourceKind !== "psql_read") {
    throw new SnapshotError("snapshot_shape", `source must be postgrest_get or psql_read.`);
  }

  const rawProjects = pick(source, "projects", "projects");
  if (!Array.isArray(rawProjects)) {
    throw new SnapshotError("snapshot_shape", "The snapshot has no projects array.");
  }

  const projects: SnapshotProject[] = rawProjects.map((entry) => {
    const p = asObject(entry, "projects[]");
    const projectId = asString(pick(p, "project_id", "projectId"), "projects[].project_id");
    const rawMedia = p.media;
    if (!Array.isArray(rawMedia)) {
      throw new SnapshotError("snapshot_shape", `projects[${projectId}].media must be an array.`);
    }
    const media: SnapshotMediaRow[] = rawMedia.map((raw) => {
      const m = asObject(raw, "media[]");
      // `metadata` and `title` are refused rather than ignored. A snapshot
      // carrying them was captured by something that read columns this lane is
      // not allowed to read, and silently dropping them would hide that.
      if ("metadata" in m || "title" in m) {
        throw new SnapshotError(
          "snapshot_carries_private_columns",
          `A media row in ${projectId} carries "metadata" or "title". The capture runner ` +
            `never selects those columns; a snapshot containing them came from somewhere else ` +
            `and must not be used to plan a production write.`,
        );
      }
      return {
        projectId,
        mediaType: asString(pick(m, "media_type", "mediaType"), "media_type").trim(),
        url: asString(m.url, "url").trim(),
        sortOrder: asInteger(pick(m, "sort_order", "sortOrder"), "sort_order"),
        semanticRole: asOptionalString(pick(m, "semantic_role", "semanticRole"), "semantic_role"),
      };
    });
    return {
      projectId,
      slug: asString(p.slug, "projects[].slug"),
      name: asString(p.name ?? "", "projects[].name"),
      isActive: asBoolean(pick(p, "is_active", "isActive"), "projects[].is_active"),
      publicStatus: asString(pick(p, "public_status", "publicStatus"), "projects[].public_status"),
      mainImageUrl: asOptionalString(pick(p, "main_image_url", "mainImageUrl"), "main_image_url"),
      media,
    };
  });

  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const project of projects) {
    if (slugs.has(project.slug)) {
      throw new SnapshotError(
        "snapshot_duplicate_slug",
        `Two projects share slug ${project.slug}.`,
      );
    }
    if (ids.has(project.projectId)) {
      throw new SnapshotError(
        "snapshot_duplicate_id",
        `Two projects share id ${project.projectId}.`,
      );
    }
    slugs.add(project.slug);
    ids.add(project.projectId);
  }

  return {
    schemaVersion,
    capturedAt: asString(pick(source, "captured_at", "capturedAt") ?? "", "captured_at"),
    source: sourceKind,
    projectRef,
    semanticRoleColumnPresent: asBoolean(
      pick(source, "semantic_role_column_present", "semanticRoleColumnPresent") ?? false,
      "semantic_role_column_present",
    ),
    projects,
    businessBaseline: parseBaseline(pick(source, "business_baseline", "businessBaseline")),
  };
}

/** A row as the census SQL and the pg harness hand it over. */
export interface RawRow {
  project_id: string;
  slug: string;
  name?: string | null;
  is_active: boolean | string;
  public_status: string;
  main_image_url?: string | null;
  media_type: string;
  url: string;
  sort_order: number | string;
  semantic_role?: string | null;
}

/**
 * Build a snapshot from flat rows, for a caller that already has a connection.
 *
 * The disposable-cluster harness uses this: it can read the target directly and
 * has no reason to round-trip through a file. `capturedAt` is set by the caller
 * through the returned object if it wants one — it is excluded from every
 * digest, so leaving it empty changes nothing that is compared.
 */
export function snapshotFromPsqlRows(
  rows: readonly RawRow[],
  projectRef: string,
): ProductionSnapshot {
  const byProject = new Map<string, SnapshotProject>();
  let sawRole = false;
  for (const raw of rows) {
    let project = byProject.get(raw.project_id);
    if (!project) {
      project = {
        projectId: raw.project_id,
        slug: raw.slug,
        name: raw.name ?? raw.slug,
        isActive: asBoolean(raw.is_active, "is_active"),
        publicStatus: raw.public_status,
        mainImageUrl: raw.main_image_url ?? null,
        media: [],
      };
      byProject.set(raw.project_id, project);
    }
    if (raw.semantic_role !== undefined) sawRole = true;
    project.media.push({
      projectId: raw.project_id,
      mediaType: String(raw.media_type).trim(),
      url: String(raw.url).trim(),
      sortOrder: asInteger(raw.sort_order, "sort_order"),
      semanticRole: raw.semantic_role ? String(raw.semantic_role) : null,
    });
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: "",
    source: "psql_read",
    projectRef,
    semanticRoleColumnPresent: sawRole,
    projects: [...byProject.values()],
    businessBaseline: { capturedBy: "unavailable", projects: [] },
  };
}

export function rowsForProject(
  snapshot: ProductionSnapshot,
  projectId: string,
): SnapshotMediaRow[] {
  const project = snapshot.projects.find((entry) => entry.projectId === projectId);
  return project ? project.media : [];
}

/**
 * The project's rows grouped by URL — the match key this whole backfill uses.
 *
 * NOT `sort_order`: Coralina and Sierra each hold two `cover` rows both at
 * `sort_order` 0, because re-publication appends rather than replaces.
 *
 * NOT `(media_type, url)`: Coralina's superseded launch-event image is a
 * `cover` row in production and a `gallery` item in every package that contains
 * it, so a media-type-bearing join silently skips exactly the row this contract
 * exists to hide.
 */
export function urlsOf(project: SnapshotProject): Map<string, SnapshotMediaRow[]> {
  const byUrl = new Map<string, SnapshotMediaRow[]>();
  for (const row of project.media) {
    const existing = byUrl.get(row.url);
    if (existing) existing.push(row);
    else byUrl.set(row.url, [row]);
  }
  return byUrl;
}
