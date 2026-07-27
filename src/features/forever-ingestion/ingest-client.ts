/**
 * Progressive ingestion — server-side RPC client.
 *
 * This module is OWNER TOOLING ONLY. It is imported exclusively by the CLI
 * entry point (`src/features/forever-ingestion/cli.ts`), never by the web
 * application graph, and it reads the service-role credential from the
 * process environment exactly like the existing import tooling
 * (src/import/database.ts). No credential ever appears in source, output,
 * or the browser bundle.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseFetch } from "@/import/database";

import type { ProgressiveBatch, ProgressiveBatchSummary } from "./batch-types";
import { assertProgressiveBatchStructure, PROGRESSIVE_INGEST_FUNCTION } from "./batch-types";
import type { DependencyCandidate, DependencyReader } from "./dependency-resolution";

export interface ProgressiveIngestClient {
  ingest(batch: ProgressiveBatch): Promise<ProgressiveBatchSummary>;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createServiceRoleClient(): SupabaseClient {
  const url = requireEnvironment("SUPABASE_URL");
  const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    global: { fetch: createSupabaseFetch(serviceRoleKey) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createProgressiveIngestClient(
  client: SupabaseClient = createServiceRoleClient(),
): ProgressiveIngestClient {
  return {
    async ingest(batch) {
      assertProgressiveBatchStructure(batch);
      const { data, error } = await client.rpc(PROGRESSIVE_INGEST_FUNCTION, { batch });
      if (error) throw new Error(`forever_progressive_ingest failed: ${error.message}`);
      return data as ProgressiveBatchSummary;
    },
  };
}

export function createDependencyReader(client: SupabaseClient): DependencyReader {
  async function query(
    table: "developers" | "locations",
    nameColumn: "name" | "area_name",
    q: { slug: string; name: string },
  ): Promise<DependencyCandidate[]> {
    const [slugResult, nameResult] = await Promise.all([
      client.from(table).select(`id,slug,${nameColumn}`).eq("slug", q.slug),
      client.from(table).select(`id,slug,${nameColumn}`).eq(nameColumn, q.name),
    ]);
    if (slugResult.error) throw new Error(`${table} dependency read failed: ${slugResult.error.message}`);
    if (nameResult.error) throw new Error(`${table} dependency read failed: ${nameResult.error.message}`);
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of [...(slugResult.data ?? []), ...(nameResult.data ?? [])] as Array<Record<string, unknown>>) {
      byId.set(String(row.id), row);
    }
    const rows = [...byId.values()];
    return rows.map((row) => ({
      id: String(row.id),
      slug: (row.slug as string | null) ?? null,
      name: String(row[nameColumn] ?? ""),
    }));
  }

  return {
    findDevelopers: (q) => query("developers", "name", q),
    findLocations: (q) => query("locations", "area_name", q),
  };
}
