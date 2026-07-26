/**
 * Owner Direct Publish — production-bound dependency wiring
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001).
 *
 * Server/CLI only. The service-role credential is read from the process
 * environment exactly like the existing owner tooling
 * (src/features/forever-ingestion/ingest-client.ts) and never appears in
 * source, in output, in a result object, or in the browser bundle.
 *
 * The production identity is proven here BEFORE a client is constructed, so a
 * misconfigured environment fails without any request being made and staging can
 * never be contacted even accidentally.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ProgressiveBatch } from "../forever-ingestion/batch-types";
import { createSupabaseFetch } from "../../import/database";

import {
  PUBLIC_IMAGE_BUCKET,
  type DirectPublishDeps,
  type DirectPublishSummary,
  type PublicMediaUpload,
} from "./publish";
import { assertProductionTarget, DIRECT_PUBLISH_TARGET, type VerifiedTarget } from "./target";

export const DIRECT_PUBLISH_FUNCTION = "forever_direct_publish" as const;

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Prove production, then build the service-role client for it. */
export function createProductionClient(): { client: SupabaseClient; target: VerifiedTarget } {
  const target = assertProductionTarget({
    supabaseUrl: process.env.SUPABASE_URL,
    requestedTarget: DIRECT_PUBLISH_TARGET,
  });
  const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(target.url, serviceRoleKey, {
    global: { fetch: createSupabaseFetch(serviceRoleKey) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, target };
}

/**
 * Public object URL for an uploaded derivative. Derived from the proven
 * production origin and the bucket/path only — never from a signed URL, so
 * nothing time-limited or credential-bearing reaches a public media row.
 */
export function publicObjectUrl(target: VerifiedTarget, bucket: string, path: string): string {
  return `${target.url}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

export function createDirectPublishDeps(input?: {
  client?: SupabaseClient;
  target?: VerifiedTarget;
  siteOrigin?: string | null;
}): DirectPublishDeps {
  const resolved =
    input?.client && input?.target
      ? { client: input.client, target: input.target }
      : createProductionClient();
  const { client, target } = resolved;

  async function upload(item: PublicMediaUpload): Promise<void> {
    const { error } = await client.storage.from(item.bucket).upload(item.path, item.bytes, {
      contentType: item.contentType,
      // Content-addressed paths: an identical retry writes identical bytes.
      upsert: true,
    });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }

  return {
    target,
    siteOrigin: input?.siteOrigin ?? process.env.FOREVER_SITE_ORIGIN ?? null,

    async projectExists(slug) {
      const { data, error } = await client.from("projects").select("id").eq("slug", slug).limit(1);
      if (error) throw new Error(`project lookup failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async knownProjectSlugs() {
      const { data, error } = await client.from("projects").select("slug").limit(1000);
      if (error) throw new Error(`project slug listing failed: ${error.message}`);
      return (data ?? []).map((row) => String((row as { slug: unknown }).slug));
    },

    async directPublish(batch: ProgressiveBatch, options) {
      const { data, error } = await client.rpc(DIRECT_PUBLISH_FUNCTION, { batch, options });
      if (error) throw new Error(`${DIRECT_PUBLISH_FUNCTION} failed: ${error.message}`);
      return data as DirectPublishSummary;
    },

    async uploadPublicMedia(item) {
      await upload(item);
      return publicObjectUrl(target, item.bucket || PUBLIC_IMAGE_BUCKET, item.path);
    },

    async retainEvidence(item) {
      await upload(item);
    },
  };
}
