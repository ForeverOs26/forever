import { describe, expect, it } from "vitest";

import {
  COLLISION_READER_METHODS,
  COLLISION_READ_BATCH_SIZE,
  CollisionReadError,
  createCollisionInspectionReader,
  createSupabaseCollisionInspectionReader,
  resolvePublishableReadCredentials,
  type SupabaseReadClient,
} from "./collision-reader";

interface Row {
  [key: string]: unknown;
  id?: string;
}

// Simple client: each query resolves once with all filtered rows plus an exact
// count equal to those rows. Used for query-shape and read-only proofs.
class FakeQuery {
  private predicates: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly rows: Row[],
    private readonly log: string[],
  ) {}

  select(columns: string, options?: { count?: string }) {
    this.log.push(
      `select(${columns.split(",").length})${options?.count === "exact" ? ":count" : ""}`,
    );
    return this;
  }
  eq(column: string, value: string) {
    this.log.push(`eq:${column}`);
    this.predicates.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: readonly string[]) {
    this.log.push(`in:${column}:${values.length}`);
    this.predicates.push((row) => values.includes(row[column] as string));
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    this.log.push(`order:${column}:${options.ascending ? "asc" : "desc"}`);
    return this;
  }
  range(from: number, to: number) {
    this.log.push(`range:${from}:${to}`);
    return this;
  }
  then<T>(resolve: (result: { data: Row[]; error: null; count: number }) => T): T {
    const data = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    return resolve({ data, error: null, count: data.length });
  }
}

class FakeReadClient {
  public readonly log: string[] = [];
  public readonly forbidden: string[] = [];
  constructor(private readonly tables: Record<string, Row[]> = {}) {}
  from(table: string) {
    this.log.push(`from:${table}`);
    return new FakeQuery(this.tables[table] ?? [], this.log);
  }
  insert() {
    this.forbidden.push("insert");
    return this;
  }
  upsert() {
    this.forbidden.push("upsert");
    return this;
  }
  update() {
    this.forbidden.push("update");
    return this;
  }
  delete() {
    this.forbidden.push("delete");
    return this;
  }
  rpc() {
    this.forbidden.push("rpc");
    return this;
  }
}

// Paged client: each query pops the next scripted page for its table, with an
// optional exact-count override per table, so multi-page pagination, provider
// caps, and count anomalies can be exercised deterministically.
type Page = Row[] | { error: true };

class PagedQuery {
  constructor(
    private readonly table: string,
    private readonly client: PagedFakeClient,
  ) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    this.client.log.push(`order:${column}:${options.ascending ? "asc" : "desc"}`);
    return this;
  }
  range(from: number, to: number) {
    this.client.log.push(`range:${from}:${to}`);
    return this;
  }
  then<T>(
    resolve: (result: {
      data: Row[] | null;
      error: { message: string } | null;
      count: number | null;
    }) => T,
  ): T {
    const page = this.client.nextPage(this.table);
    if (page && "error" in page) {
      return resolve({
        data: null,
        error: { message: "connect http://secret apikey=sb_secret" },
        count: null,
      });
    }
    return resolve({ data: page, error: null, count: this.client.countFor(this.table) });
  }
}

class PagedFakeClient {
  public readonly log: string[] = [];
  public readonly forbidden: string[] = [];
  constructor(
    private readonly pages: Record<string, Page[]>,
    private readonly counts: Record<string, number | null>,
  ) {}
  from(table: string) {
    this.log.push(`from:${table}`);
    return new PagedQuery(table, this);
  }
  nextPage(table: string): Page {
    const queue = this.pages[table] ?? [];
    return queue.length ? (queue.shift() as Page) : [];
  }
  countFor(table: string): number | null {
    return Object.prototype.hasOwnProperty.call(this.counts, table) ? this.counts[table] : null;
  }
  insert() {
    this.forbidden.push("insert");
    return this;
  }
  upsert() {
    this.forbidden.push("upsert");
    return this;
  }
  update() {
    this.forbidden.push("update");
    return this;
  }
  delete() {
    this.forbidden.push("delete");
    return this;
  }
  rpc() {
    this.forbidden.push("rpc");
    return this;
  }
}

function asClient(client: FakeReadClient | PagedFakeClient): SupabaseReadClient {
  return client as unknown as SupabaseReadClient;
}

function pagedClient(pages: Record<string, Page[]>, counts: Record<string, number | null>) {
  return new PagedFakeClient(pages, counts);
}

describe("RC5.5B Supabase read adapter — query shape", () => {
  it("reads a project by exact slug with an exact count, ordered by id", async () => {
    const client = new FakeReadClient({
      projects: [
        { id: "p1", slug: "coralina" },
        { id: "p2", slug: "other" },
      ],
    });
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    const rows = await reader.readProjectRows("coralina");
    expect(rows).toHaveLength(1);
    expect(client.log).toContain("from:projects");
    expect(client.log).toContain("eq:slug");
    expect(client.log).toContain("order:id:asc");
    expect(client.log.some((entry) => entry.endsWith(":count"))).toBe(true);
    expect(client.log.some((entry) => entry.startsWith("range:"))).toBe(true);
  });

  it("reads buildings filtered by resolved project_id and planned building_code batch", async () => {
    const client = new FakeReadClient({
      buildings: [
        { id: "b1", project_id: "p1", building_code: "A" },
        { id: "b2", project_id: "p1", building_code: "Z" },
      ],
    });
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    const rows = await reader.readBuildingRows("p1", ["A"]);
    expect(rows.map((row) => row.id)).toEqual(["b1"]);
    expect(client.log).toContain("eq:project_id");
    expect(client.log).toContain("in:building_code:1");
  });

  it("reads units filtered by resolved project_id and planned unit_code batch", async () => {
    const client = new FakeReadClient({
      units: [{ id: "u1", project_id: "p1", unit_code: "A-1" }],
    });
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    const rows = await reader.readUnitRows("p1", ["A-1"]);
    expect(rows).toHaveLength(1);
    expect(client.log).toContain("in:unit_code:1");
  });

  it("returns an empty array without querying when no keys are planned", async () => {
    const client = new FakeReadClient({});
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    expect(await reader.readBuildingRows("p1", [])).toEqual([]);
    expect(await reader.readPriceHistoryRows([])).toEqual([]);
    expect(client.log).toEqual([]);
  });
});

describe("RC5.5B Supabase read adapter — IN batching", () => {
  it("splits large unit-code reads into bounded batches", async () => {
    const client = new FakeReadClient({ units: [] });
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    const codes = Array.from({ length: 250 }, (_, index) => `U-${index}`);
    await reader.readUnitRows("p1", codes);
    const fromUnits = client.log.filter((entry) => entry === "from:units").length;
    expect(fromUnits).toBe(Math.ceil(250 / COLLISION_READ_BATCH_SIZE));
    expect(fromUnits).toBe(3);
  });

  it("splits large price-history reads into bounded batches", async () => {
    const client = new FakeReadClient({ unit_price_history: [] });
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    const unitIds = Array.from({ length: 201 }, (_, index) => `unit-${index}`);
    await reader.readPriceHistoryRows(unitIds);
    const reads = client.log.filter((entry) => entry === "from:unit_price_history").length;
    expect(reads).toBe(3);
  });
});

describe("RC5.5B Supabase read adapter — exact-count completeness proof", () => {
  const opts = { pageSize: 2 };

  it("keeps reading when a provider cap returns fewer rows than requested while more remain", async () => {
    // Requested page size 2, but the server caps every response at 1 row.
    const client = pagedClient(
      {
        projects: [[{ id: "p1", slug: "s" }], [{ id: "p2", slug: "s" }], [{ id: "p3", slug: "s" }]],
      },
      { projects: 3 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    const rows = await reader.readProjectRows("s");
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
    // Offsets advance by rows actually received, not by the requested size.
    expect(client.log).toContain("range:0:1");
    expect(client.log).toContain("range:1:2");
    expect(client.log).toContain("range:2:3");
  });

  it("continues across pages until exactly the expected count is collected", async () => {
    const client = pagedClient(
      {
        projects: [
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
          [{ id: "p3", slug: "s" }],
        ],
      },
      { projects: 3 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    const rows = await reader.readProjectRows("s");
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
    expect(client.log).toContain("order:id:asc");
  });

  it("completes at an exact page boundary without inferring from a short page", async () => {
    const client = pagedClient(
      {
        projects: [
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
        ],
      },
      { projects: 2 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    const rows = await reader.readProjectRows("s");
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    // collected === count after the first page: no extra page is requested.
    expect(client.log.filter((entry) => entry === "from:projects")).toHaveLength(1);
  });

  it("blocks when zero rows return but the exact count is greater than zero", async () => {
    const client = pagedClient({ projects: [[]] }, { projects: 2 });
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "incomplete_result",
    });
  });

  it("blocks when the exact count is missing", async () => {
    const client = pagedClient({ projects: [[{ id: "p1", slug: "s" }]] }, { projects: null });
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "incomplete_result",
    });
  });

  it("blocks when the exact count is malformed", async () => {
    const client = pagedClient({ projects: [[{ id: "p1", slug: "s" }]] }, { projects: -1 });
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "incomplete_result",
    });
  });

  it("blocks when pages dry up before the expected count is reached", async () => {
    const client = pagedClient({ projects: [[{ id: "p1", slug: "s" }], []] }, { projects: 3 });
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "incomplete_result",
    });
  });

  it("blocks when collected rows exceed the exact count", async () => {
    const client = pagedClient(
      {
        projects: [
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
          [
            { id: "p3", slug: "s" },
            { id: "p4", slug: "s" },
          ],
        ],
      },
      { projects: 3 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "pagination_inconsistent",
    });
  });

  it("blocks on a duplicate row id across pages", async () => {
    const client = pagedClient(
      {
        projects: [
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
          [
            { id: "p2", slug: "s" },
            { id: "p3", slug: "s" },
          ],
        ],
      },
      { projects: 4 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "pagination_inconsistent",
    });
  });

  it("blocks on a repeated / non-advancing page", async () => {
    const client = pagedClient(
      {
        projects: [
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
        ],
      },
      { projects: 4 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    await expect(reader.readProjectRows("s")).rejects.toMatchObject({
      code: "pagination_inconsistent",
    });
  });

  it("maps a later-page query failure to a sanitized read error, never absent", async () => {
    const client = pagedClient(
      {
        unit_price_history: [
          [
            { id: "ph1", unit_id: "u1" },
            { id: "ph2", unit_id: "u1" },
          ],
          { error: true },
        ],
      },
      { unit_price_history: 4 },
    );
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    const error = await reader.readPriceHistoryRows(["u1"]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollisionReadError);
    expect((error as CollisionReadError).code).toBe("price_history_read_failed");
    expect((error as Error).message).not.toContain("http");
    expect((error as Error).message).not.toContain("sb_secret");
  });

  it("accepts a zero-row result only when the exact count proves zero", async () => {
    const client = pagedClient({ projects: [[]] }, { projects: 0 });
    const reader = createSupabaseCollisionInspectionReader(asClient(client), opts);
    expect(await reader.readProjectRows("s")).toEqual([]);
  });

  it("performs zero mutation calls on every pagination path", async () => {
    const success = pagedClient(
      {
        projects: [
          [
            { id: "p1", slug: "s" },
            { id: "p2", slug: "s" },
          ],
          [{ id: "p3", slug: "s" }],
        ],
      },
      { projects: 3 },
    );
    await createSupabaseCollisionInspectionReader(asClient(success), opts).readProjectRows("s");
    expect(success.forbidden).toEqual([]);

    const failure = pagedClient({ projects: [[]] }, { projects: 2 });
    await createSupabaseCollisionInspectionReader(asClient(failure), opts)
      .readProjectRows("s")
      .catch(() => undefined);
    expect(failure.forbidden).toEqual([]);
  });
});

describe("RC5.5B Supabase read adapter — read-only proof", () => {
  it("never invokes any mutation method on the client", async () => {
    const client = new FakeReadClient({
      projects: [{ id: "p1", slug: "coralina" }],
      developers: [{ id: "d1", slug: "dev" }],
      locations: [{ id: "l1", slug: "loc" }],
      buildings: [{ id: "b1", project_id: "p1", building_code: "A" }],
      units: [{ id: "u1", project_id: "p1", unit_code: "A-1" }],
      unit_price_history: [{ id: "ph1", unit_id: "u1" }],
    });
    const reader = createSupabaseCollisionInspectionReader(asClient(client));

    await reader.readProjectRows("coralina");
    await reader.readDeveloperRows("dev");
    await reader.readLocationRows("loc");
    await reader.readBuildingRows("p1", ["A"]);
    await reader.readUnitRows("p1", ["A-1"]);
    await reader.readPriceHistoryRows(["u1"]);

    expect(client.forbidden).toEqual([]);
    const verbs = new Set(client.log.map((entry) => entry.split(/[:(]/)[0]));
    expect([...verbs].sort()).toEqual(["eq", "from", "in", "order", "range", "select"]);
  });

  it("does not expose the underlying client as a runtime property", () => {
    const client = new FakeReadClient({});
    const reader = createSupabaseCollisionInspectionReader(asClient(client));
    expect(Object.keys(reader).sort()).toEqual([...COLLISION_READER_METHODS].sort());
    for (const value of Object.values(reader)) {
      expect(value).not.toBe(client);
      expect(typeof value).toBe("function");
    }
  });
});

describe("RC5.5B publishable credential boundary", () => {
  it("resolves url and publishable key without reading the service-role key", () => {
    const reads: string[] = [];
    const env = new Proxy(
      {
        SUPABASE_URL: "http://local",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_must_not_read",
      } as Record<string, string | undefined>,
      {
        get(target, key: string) {
          reads.push(key);
          return target[key];
        },
      },
    );

    const credentials = resolvePublishableReadCredentials(env);
    expect(credentials).toEqual({ url: "http://local", key: "sb_publishable_local" });
    expect(reads).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("fails closed when the publishable key is missing, with no service-role fallback", () => {
    expect(() =>
      resolvePublishableReadCredentials({
        SUPABASE_URL: "http://local",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret",
      }),
    ).toThrow("SUPABASE_PUBLISHABLE_KEY");
  });

  it("fails closed when the url is missing", () => {
    expect(() =>
      resolvePublishableReadCredentials({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local" }),
    ).toThrow("SUPABASE_URL");
  });

  it("does not create a client or network connection when the publishable key is missing", () => {
    expect(() =>
      createCollisionInspectionReader({
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret",
        SUPABASE_URL: "http://local",
      }),
    ).toThrow("SUPABASE_PUBLISHABLE_KEY");
  });
});
