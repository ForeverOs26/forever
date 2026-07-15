import { createClient } from "@supabase/supabase-js";

import { createSupabaseFetch } from "./database";

/**
 * RC5.5B read-only target reader.
 *
 * Defines the narrow, select-only interface used by the collision inspector and
 * a closure-based Supabase adapter. The inspector is never handed the
 * mutation-capable {@link import("./database").DatabaseLayer}; it only ever sees
 * a {@link CollisionInspectionReader}, which cannot insert, upsert, update,
 * delete, run a mutation RPC, or change schema. The underlying Supabase client
 * is captured in a closure and is never exposed as a runtime property.
 *
 * Reads are deterministic and complete: every logical query requests an exact
 * PostgREST row count and paginates by ascending immutable `id` until the
 * number of uniquely collected rows equals that count. Completeness is proven
 * by the count — never inferred from a short page — so a server-side row cap
 * or partial response fails closed (`incomplete_result` /
 * `pagination_inconsistent`) instead of silently becoming an `absent` finding.
 */

/** Stable project columns compared against the plan. */
export interface TargetProjectRow {
  id: string;
  slug: string;
  name: string | null;
  developer_id: string | null;
  location_id: string | null;
  project_code: string | null;
  project_type: string | null;
  location_area: string | null;
  address: string | null;
  short_description: string | null;
  full_description: string | null;
  is_active: boolean | null;
  public_status: string | null;
  sales_status: string | null;
}

export interface TargetDeveloperRow {
  id: string;
  slug: string | null;
}

export interface TargetLocationRow {
  id: string;
  slug: string | null;
}

export interface TargetBuildingRow {
  id: string;
  project_id: string | null;
  building_code: string | null;
  name: string | null;
  building_type: string | null;
  floors_count: number | null;
  units_count: number | null;
  metadata: unknown;
}

export interface TargetUnitRow {
  id: string;
  project_id: string | null;
  building_id: string | null;
  unit_code: string | null;
  unit_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: number | string | null;
  floor: number | null;
  base_price_thb: number | string | null;
  price_per_sqm: number | string | null;
  availability_status: string | null;
  unit_status: string | null;
  metadata: unknown;
}

export interface TargetPriceHistoryRow {
  id: string;
  unit_id: string;
  price: number | string | null;
  currency: string | null;
  price_source: string | null;
  source_file: string | null;
  source_page: number | null;
  price_list_date: string | null;
  recorded_at: string | null;
  metadata: unknown;
}

/**
 * The only capability the collision inspector has against the target: bounded,
 * natural-key-scoped, fully-paginated select queries. There is intentionally no
 * write, upsert, delete, or RPC surface.
 */
export interface CollisionInspectionReader {
  readProjectRows(slug: string): Promise<TargetProjectRow[]>;
  readDeveloperRows(slug: string): Promise<TargetDeveloperRow[]>;
  readLocationRows(slug: string): Promise<TargetLocationRow[]>;
  readBuildingRows(projectId: string, buildingCodes: string[]): Promise<TargetBuildingRow[]>;
  readUnitRows(projectId: string, unitCodes: string[]): Promise<TargetUnitRow[]>;
  readPriceHistoryRows(unitIds: string[]): Promise<TargetPriceHistoryRow[]>;
}

export const COLLISION_READER_METHODS = [
  "readProjectRows",
  "readDeveloperRows",
  "readLocationRows",
  "readBuildingRows",
  "readUnitRows",
  "readPriceHistoryRows",
] as const;

const FORBIDDEN_READER_METHODS = [
  "insert",
  "upsert",
  "update",
  "delete",
  "rpc",
  "upsertDeveloper",
  "upsertLocation",
  "upsertProject",
  "upsertBuildings",
  "upsertUnits",
  "upsertPriceHistory",
] as const;

function isDatabaseClientLike(value: unknown): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.from === "function" ||
    typeof candidate.rpc === "function" ||
    typeof candidate.insert === "function"
  );
}

/**
 * Fail-closed guard: refuses any reader that exposes a mutation-shaped method or
 * a runtime-accessible database client.
 */
export function assertReadOnlyReader(reader: CollisionInspectionReader): void {
  const candidate = reader as unknown as Record<string, unknown>;
  for (const name of FORBIDDEN_READER_METHODS) {
    if (typeof candidate[name] === "function") {
      throw new Error(
        `Collision inspection reader must not expose mutation method "${name}"; inspection is read-only.`,
      );
    }
  }
  for (const [key, value] of Object.entries(candidate)) {
    if (isDatabaseClientLike(value)) {
      throw new Error(
        `Collision inspection reader must not expose a database client (property "${key}"); it must stay private.`,
      );
    }
  }
}

/** Bounded batch size for `IN (...)` filters. Keeps reads plan-scoped. */
export const COLLISION_READ_BATCH_SIZE = 100;
/** Fixed page size for id-ordered pagination. */
export const COLLISION_READ_PAGE_SIZE = 1000;
/** Backstop page cap; real reads terminate far sooner on the short final page. */
export const COLLISION_READ_MAX_PAGES = 100_000;

export type CollisionReadErrorCode =
  | "project_read_failed"
  | "dependency_read_failed"
  | "building_read_failed"
  | "unit_read_failed"
  | "price_history_read_failed"
  | "incomplete_result"
  | "pagination_inconsistent";

/**
 * Sanitized read failure. Carries only a stable code and a safe table name —
 * never a raw provider/network message, URL, or credential.
 */
export class CollisionReadError extends Error {
  constructor(
    public readonly code: CollisionReadErrorCode,
    public readonly table: string,
  ) {
    super(code);
    this.name = "CollisionReadError";
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

const PROJECT_COLUMNS =
  "id,slug,name,developer_id,location_id,project_code,project_type,location_area,address,short_description,full_description,is_active,public_status,sales_status";
const DEVELOPER_COLUMNS = "id,slug";
const LOCATION_COLUMNS = "id,slug";
const BUILDING_COLUMNS =
  "id,project_id,building_code,name,building_type,floors_count,units_count,metadata";
const UNIT_COLUMNS =
  "id,project_id,building_id,unit_code,unit_type,bedrooms,bathrooms,size_sqm,floor,base_price_thb,price_per_sqm,availability_status,unit_status,metadata";
const PRICE_HISTORY_COLUMNS =
  "id,unit_id,price,currency,price_source,source_file,source_page,price_list_date,recorded_at,metadata";

// Minimal structural read surface. Casting the Supabase client to this type
// makes it impossible for the adapter to call any mutation method.
interface ReadResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
  /** Exact filtered row count returned by PostgREST when `count: "exact"` is requested. */
  count: number | null;
}

interface ReadFilter<Row> extends PromiseLike<ReadResult<Row>> {
  eq(column: string, value: string): ReadFilter<Row>;
  in(column: string, values: readonly string[]): ReadFilter<Row>;
  order(column: string, options: { ascending: boolean }): ReadFilter<Row>;
  range(from: number, to: number): ReadFilter<Row>;
}

interface ReadTable {
  select(columns: string, options: { count: "exact" }): ReadFilter<Record<string, unknown>>;
}

export interface SupabaseReadClient {
  from(table: string): ReadTable;
}

export interface CollisionReaderOptions {
  pageSize?: number;
}

/**
 * Closure-based select-only adapter. The `client` is captured in scope and is
 * never assigned as a property of the returned reader, so it cannot be reached
 * at runtime through the reader object.
 */
export function createSupabaseCollisionInspectionReader(
  client: SupabaseReadClient,
  options: CollisionReaderOptions = {},
): CollisionInspectionReader {
  const pageSize = options.pageSize ?? COLLISION_READ_PAGE_SIZE;

  // Fully paginate one logical query with an exact-count completeness proof:
  // every page requests the exact PostgREST count for the filtered query, and
  // the read is complete only when the number of uniquely collected rows equals
  // that count. Completeness is never inferred from a short page, so a
  // server-side maximum-row cap that returns fewer rows than requested cannot
  // silently truncate the result. Any inconsistency fails closed.
  async function selectAll<Row extends { id?: unknown }>(
    table: string,
    columns: string,
    code: CollisionReadErrorCode,
    applyFilters: (
      query: ReadFilter<Record<string, unknown>>,
    ) => ReadFilter<Record<string, unknown>>,
  ): Promise<Row[]> {
    const collected: Row[] = [];
    const seen = new Set<string>();
    let expectedCount: number | null = null;
    let offset = 0;

    for (let page = 0; ; page += 1) {
      if (page >= COLLISION_READ_MAX_PAGES) {
        throw new CollisionReadError("pagination_inconsistent", table);
      }

      const { data, error, count } = await applyFilters(
        client.from(table).select(columns, { count: "exact" }),
      )
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new CollisionReadError(code, table);

      // The exact count is the completeness contract: it must be present, a
      // non-negative integer, and identical on every page of this read.
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new CollisionReadError("incomplete_result", table);
      }
      if (expectedCount === null) expectedCount = count;
      else if (count !== expectedCount) {
        throw new CollisionReadError("pagination_inconsistent", table);
      }

      const rows = (data ?? []) as Row[];
      let newRows = 0;
      for (const row of rows) {
        const id = row.id;
        if (typeof id !== "string" || id.length === 0) {
          throw new CollisionReadError("incomplete_result", table);
        }
        if (seen.has(id)) throw new CollisionReadError("pagination_inconsistent", table);
        seen.add(id);
        collected.push(row);
        newRows += 1;
      }

      if (collected.length > expectedCount) {
        throw new CollisionReadError("pagination_inconsistent", table);
      }
      if (collected.length === expectedCount) break; // proven complete

      // Still below the expected count: the read must keep advancing.
      if (rows.length === 0) throw new CollisionReadError("incomplete_result", table);
      if (newRows === 0) throw new CollisionReadError("pagination_inconsistent", table);
      // Advance by the rows actually received (a provider cap may return fewer
      // rows than requested even though more matching rows remain).
      offset += rows.length;
    }

    return collected;
  }

  async function selectBatched<Row extends { id?: unknown }>(
    table: string,
    columns: string,
    code: CollisionReadErrorCode,
    keyColumn: string,
    keys: string[],
    scope: (query: ReadFilter<Record<string, unknown>>) => ReadFilter<Record<string, unknown>>,
  ): Promise<Row[]> {
    if (keys.length === 0) return [];
    const rows: Row[] = [];
    for (const batch of chunk(keys, COLLISION_READ_BATCH_SIZE)) {
      rows.push(
        ...(await selectAll<Row>(table, columns, code, (query) =>
          scope(query).in(keyColumn, batch),
        )),
      );
    }
    return rows;
  }

  return {
    readProjectRows(slug) {
      return selectAll<TargetProjectRow>(
        "projects",
        PROJECT_COLUMNS,
        "project_read_failed",
        (query) => query.eq("slug", slug),
      );
    },
    readDeveloperRows(slug) {
      return selectAll<TargetDeveloperRow>(
        "developers",
        DEVELOPER_COLUMNS,
        "dependency_read_failed",
        (query) => query.eq("slug", slug),
      );
    },
    readLocationRows(slug) {
      return selectAll<TargetLocationRow>(
        "locations",
        LOCATION_COLUMNS,
        "dependency_read_failed",
        (query) => query.eq("slug", slug),
      );
    },
    readBuildingRows(projectId, buildingCodes) {
      return selectBatched<TargetBuildingRow>(
        "buildings",
        BUILDING_COLUMNS,
        "building_read_failed",
        "building_code",
        buildingCodes,
        (query) => query.eq("project_id", projectId),
      );
    },
    readUnitRows(projectId, unitCodes) {
      return selectBatched<TargetUnitRow>(
        "units",
        UNIT_COLUMNS,
        "unit_read_failed",
        "unit_code",
        unitCodes,
        (query) => query.eq("project_id", projectId),
      );
    },
    async readPriceHistoryRows(unitIds) {
      if (unitIds.length === 0) return [];
      const rows: TargetPriceHistoryRow[] = [];
      for (const batch of chunk(unitIds, COLLISION_READ_BATCH_SIZE)) {
        rows.push(
          ...(await selectAll<TargetPriceHistoryRow>(
            "unit_price_history",
            PRICE_HISTORY_COLUMNS,
            "price_history_read_failed",
            (query) => query.in("unit_id", batch),
          )),
        );
      }
      return rows;
    },
  };
}

export interface PublishableReadCredentials {
  url: string;
  key: string;
}

/**
 * Resolves the ONLY approved read credential for collision inspection: the
 * publishable key. The service-role key is never read and there is no fallback.
 * Fails closed before any client or network creation when either value is
 * missing. Accepts an injectable env for hermetic testing.
 */
export function resolvePublishableReadCredentials(
  env: Record<string, string | undefined> = process.env,
): PublishableReadCredentials {
  const url = env.SUPABASE_URL;
  if (!url) throw new Error("Missing required environment variable: SUPABASE_URL");
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Missing required environment variable: SUPABASE_PUBLISHABLE_KEY");
  return { url, key };
}

/**
 * Creates the read-only Supabase reader from the publishable credential. The
 * Supabase client is created lazily here — never during a dry-run and never in
 * hermetic tests, which inject their own {@link CollisionInspectionReader}.
 */
export function createCollisionInspectionReader(
  env: Record<string, string | undefined> = process.env,
  options: CollisionReaderOptions = {},
): CollisionInspectionReader {
  const { url, key } = resolvePublishableReadCredentials(env);
  const client = createClient(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return createSupabaseCollisionInspectionReader(client as unknown as SupabaseReadClient, options);
}
