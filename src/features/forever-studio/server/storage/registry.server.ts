/**
 * Forever Studio — storage provider assembly (SERVER ONLY).
 *
 * Reads the deployment's storage configuration and builds the provider set.
 * The ONLY module that touches R2 credentials, and the only one that decides
 * which provider a NEW job is created with.
 *
 * Nothing here is exported to a client-reachable module: the file is
 * `.server.ts`, it is reached exclusively through the Studio dependency
 * assembly, and the bundle-boundary tests pin that.
 */

import { StudioAccessError } from "../contracts";
import type { StudioStorage } from "../contracts";
import type { StudioStorageProviderId } from "../../studio-types";
import { R2Client } from "./r2-client.server";
import { isWorkerRuntime, requireStudioR2Bindings } from "./r2-bindings.server";
import {
  createR2StorageProvider,
  type R2ProviderConfig,
  type StudioR2Runtime,
} from "./r2-provider.server";
import type { StudioStorageProvider, StudioStorageProviderSet } from "./provider";
import { createSupabaseStorageProvider } from "./supabase-provider";
import {
  resolveWriteProviderValue,
  STUDIO_STORAGE_WRITE_PROVIDER_ENV,
  STUDIO_WRITE_PROVIDER_INVALID_CODE,
} from "./write-provider";

/** Bucket names the deployment binds. Overridable, with the agreed defaults. */
export const DEFAULT_R2_BUCKETS = {
  privateSources: "forever-private-sources",
  publicMedia: "forever-public-media",
  projectArchives: "forever-project-archives",
} as const;

/** Origin the `/media/…` route is served from when nothing is configured. */
export const DEFAULT_PUBLIC_MEDIA_ORIGIN = "https://forever.phuketre22.workers.dev";

export function readPublicMediaOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.FOREVER_PUBLIC_MEDIA_ORIGIN?.trim() ||
    env.FOREVER_SITE_ORIGIN?.trim() ||
    env.VITE_PUBLIC_SITE_ORIGIN?.trim() ||
    DEFAULT_PUBLIC_MEDIA_ORIGIN
  );
}

export function readR2BucketNames(
  env: NodeJS.ProcessEnv = process.env,
): R2ProviderConfig["buckets"] {
  return {
    privateSources: env.R2_BUCKET_PRIVATE_SOURCES?.trim() || DEFAULT_R2_BUCKETS.privateSources,
    publicMedia: env.R2_BUCKET_PUBLIC_MEDIA?.trim() || DEFAULT_R2_BUCKETS.publicMedia,
    projectArchives: env.R2_BUCKET_PROJECT_ARCHIVES?.trim() || DEFAULT_R2_BUCKETS.projectArchives,
  };
}

/**
 * The R2 S3 client, or a refusal.
 *
 * Missing credentials are a REFUSAL, never a downgrade: a deployment that asks
 * for R2 and cannot reach it must fail closed, because the alternative is
 * silently writing project material somewhere the Owner did not choose.
 */
export function createR2ClientFromEnv(env: NodeJS.ProcessEnv = process.env): R2Client {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    // The message names the MISSING variables only — never a value, never a
    // partial key.
    const missing = [
      ...(accountId ? [] : ["R2_ACCOUNT_ID"]),
      ...(accessKeyId ? [] : ["R2_ACCESS_KEY_ID"]),
      ...(secretAccessKey ? [] : ["R2_SECRET_ACCESS_KEY"]),
    ].join(", ");
    throw new StudioAccessError(
      "storage_provider_unavailable",
      `Cloudflare R2 is selected but not configured (missing: ${missing}).`,
    );
  }
  return new R2Client({
    accountId,
    accessKeyId,
    secretAccessKey,
    ...(env.R2_S3_ENDPOINT?.trim() ? { endpoint: env.R2_S3_ENDPOINT.trim() } : {}),
  });
}

export type StudioStorageProviders = StudioStorageProviderSet;

/**
 * Resolve `STUDIO_STORAGE_WRITE_PROVIDER`.
 *
 * See write-provider.ts for the full documented matrix. A non-empty
 * unrecognized value refuses new job creation rather than silently applying the
 * old behaviour.
 */
export function resolveWriteProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StudioStorageProviderId {
  const resolution = resolveWriteProviderValue(env[STUDIO_STORAGE_WRITE_PROVIDER_ENV]);
  if (!resolution.provider) {
    throw new StudioAccessError(
      STUDIO_WRITE_PROVIDER_INVALID_CODE,
      `${STUDIO_STORAGE_WRITE_PROVIDER_ENV} is set to a value Forever does not recognize. Uploads are paused until it is set to "supabase" or "r2".`,
    );
  }
  return resolution.provider;
}

/**
 * Which transport this process performs SERVER-SIDE R2 object operations over.
 *
 * On a Cloudflare Worker it is the native bucket bindings, always — the S3
 * endpoint is not reachable from inside an isolate, which is why the first real
 * R2 production pilot uploaded 51,937,418 bytes successfully from the browser
 * and then failed on its own very first server-side HEAD. Everywhere else it is
 * the S3 object plane, which is what local development and the tests exercise.
 *
 * There is deliberately NO third case. A Worker without usable bindings does
 * not quietly fall back to S3-over-fetch; `requireStudioR2Bindings` refuses.
 */
export function resolveStudioR2Runtime(): StudioR2Runtime {
  return isWorkerRuntime() ? "worker" : "node";
}

/**
 * Build the provider set for one server process.
 *
 * The R2 provider is created LAZILY: a deployment still running on Supabase
 * needs no R2 credentials at all, and must not fail to boot because of their
 * absence. The moment anything actually needs R2, the refusal is loud.
 */
export function createStudioStorageProviders(
  supabaseStorage: StudioStorage,
  env: NodeJS.ProcessEnv = process.env,
): StudioStorageProviders {
  const supabase = createSupabaseStorageProvider(supabaseStorage);
  let r2: StudioStorageProvider | undefined;

  return {
    get writeProviderId() {
      return resolveWriteProviderFromEnv(env);
    },
    get(id) {
      if (id === "supabase") return supabase;
      if (!r2) {
        const runtime = resolveStudioR2Runtime();
        r2 = createR2StorageProvider({
          // Still required on a Worker: presigning the browser's direct upload
          // is the one capability a binding cannot provide.
          client: createR2ClientFromEnv(env),
          runtime,
          bindings: runtime === "worker" ? requireStudioR2Bindings() : null,
          buckets: readR2BucketNames(env),
          publicOrigin: readPublicMediaOrigin(env),
        });
      }
      return r2;
    },
  };
}
