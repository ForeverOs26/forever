/**
 * Issue #103 — Studio uploads are refused anywhere but the declared production
 * origin.
 *
 * WHAT HAPPENED, IN ONE PARAGRAPH
 * -------------------------------
 * Studio was opened on a Cloudflare version-preview origin
 * (`https://ebe99b50-forever.phuketre22.workers.dev`) while production served a
 * different version at 100%. Two jobs were created — `new_development` with
 * three files and `project_update` with one — and each was handed valid signed
 * upload targets. Private storage accepts a browser write from the production
 * origin and from nowhere else, so every one of those PUTs died in its
 * cross-origin preflight and not one object arrived: 0 units, 0 prices, 0
 * media. The upload could not have succeeded from the moment the job existed.
 *
 * WHAT THESE TESTS PIN
 * --------------------
 *   - the exact production origin is allowed, and nothing else is: the incident
 *     preview origin, any other version preview, a lookalike host, an
 *     http/https mismatch, a port mismatch, and a missing or malformed origin
 *     are all refused;
 *   - the refusal happens BEFORE allocation. The negative controls assert
 *     against the data and storage fakes that no job row, audit entry, signed
 *     target, archive row or multipart upload was created — and that the
 *     allocation functions were never called at all;
 *   - the browser renders no upload interface on a preview, and links to the
 *     equivalent production route;
 *   - production-origin ordinary AND archive flows still work end to end;
 *   - the refusal carries a stable safe code and leaks nothing about the
 *     request, and the client-safe module reaches no server module.
 *
 * Nothing here contacts production, Cloudflare, Supabase or real R2.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getOverview: vi.fn(),
  startJob: vi.fn(),
  processJob: vi.fn(),
  planArchive: vi.fn(),
  confirmArchive: vi.fn(),
}));

vi.mock("../studio.functions", () => ({
  studioGetOverview: endpoints.getOverview,
  studioStartJob: endpoints.startJob,
  studioProcessJob: endpoints.processJob,
  studioPlanArchiveUpload: endpoints.planArchive,
  studioConfirmArchiveUpload: endpoints.confirmArchive,
  studioResumePending: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } },
}));

import {
  normalizeOrigin,
  originsMatch,
  DEFAULT_PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_ORIGIN,
} from "@/lib/site-origin";

import { StudioUploader } from "../components/StudioUploader";
import { confirmJobArchiveUpload, planJobArchiveUpload, startUploadJob } from "../server/service";
import {
  assertStudioUploadOrigin,
  resolveExpectedUploadOrigin,
} from "../server/upload-origin.server";
import { STUDIO_MATERIAL_WINDOWS } from "../studio-types";
import {
  isStudioUploadOriginAllowed,
  studioProductionUrl,
  STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
  STUDIO_UPLOAD_ORIGIN_REFUSAL_MESSAGE,
  STUDIO_UPLOAD_PREVIEW_LINK_LABEL,
  STUDIO_UPLOAD_PREVIEW_NOTE,
  STUDIO_UPLOAD_PREVIEW_TITLE,
} from "../studio-upload-origin";
import { assertLocalR2Endpoint } from "./local-r2";
import { setBrowserOrigin } from "./upload-origin-fixture";
import { makeWorld, OWNER, TEST_R2_BUCKETS, type FakeWorld } from "./fakes";

// ---------------------------------------------------------------------------
// The origins in play
// ---------------------------------------------------------------------------

/** Where Forever is actually served from, and the only origin uploads may use. */
const PRODUCTION_ORIGIN = "https://forever.phuketre22.workers.dev";

/** The exact version preview the incident happened on. */
const INCIDENT_PREVIEW_ORIGIN = "https://ebe99b50-forever.phuketre22.workers.dev";

/** A deployment that declares the production origin and nothing else. */
const PRODUCTION_ENV = { FOREVER_SITE_ORIGIN: PRODUCTION_ORIGIN } as NodeJS.ProcessEnv;

/** One inbound request, as the server actually sees it. */
function requestFrom(origin: string | null, extra?: Record<string, string>): Request {
  const headers = new Headers(extra);
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${PRODUCTION_ORIGIN}/_serverFn/studioStartJob`, {
    method: "POST",
    headers,
  });
}

/** Settle a guard call into a thrown error, or null when it allowed. */
function refusalFor(
  request: Request | null,
  env: NodeJS.ProcessEnv = PRODUCTION_ENV,
): Error | null {
  try {
    assertStudioUploadOrigin(request, env);
    return null;
  } catch (error) {
    return error as Error;
  }
}

let warned: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The guard logs one redacted server-side line per refusal; these suites
  // provoke dozens deliberately.
  warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warned.mockRestore();
});

// ---------------------------------------------------------------------------
// 1. The comparison itself
// ---------------------------------------------------------------------------

describe("origin normalization is exact and never fuzzy", () => {
  it("canonicalizes a real origin, and tolerates one trailing slash on config", () => {
    expect(normalizeOrigin(PRODUCTION_ORIGIN)).toBe(PRODUCTION_ORIGIN);
    expect(normalizeOrigin(`${PRODUCTION_ORIGIN}/`)).toBe(PRODUCTION_ORIGIN);
    expect(normalizeOrigin(`  ${PRODUCTION_ORIGIN}  `)).toBe(PRODUCTION_ORIGIN);
    // A port that equals the scheme default is not a different origin.
    expect(normalizeOrigin("https://forever.phuketre22.workers.dev:443")).toBe(PRODUCTION_ORIGIN);
  });

  it("returns null for everything that is not an origin", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      // The opaque origin a sandboxed context sends.
      "null",
      // No scheme.
      "forever.phuketre22.workers.dev",
      // Not an http(s) scheme.
      "data:text/html,<script>",
      "file:///etc/passwd",
      // Embedded credentials pointing somewhere else entirely.
      "https://forever.phuketre22.workers.dev@evil.test",
      // A path, query or fragment carrying the trusted name.
      `${PRODUCTION_ORIGIN}/studio/upload`,
      `https://evil.test/?x=${PRODUCTION_ORIGIN}`,
      `https://evil.test/#${PRODUCTION_ORIGIN}`,
      // The comma-joined value a duplicated Origin header produces.
      `${PRODUCTION_ORIGIN}, ${INCIDENT_PREVIEW_ORIGIN}`,
      "https://",
      "://forever.phuketre22.workers.dev",
      // A pattern is not a host. `URL` parses all three happily and hands back
      // `*` as the hostname; wildcard matching is not a thing this does.
      "https://*",
      "https://*.workers.dev",
      "https://*.phuketre22.workers.dev",
      // Malformed hosts.
      "https://forever..workers.dev",
      "https://-forever.workers.dev",
      "https://[::1]",
    ]) {
      expect(normalizeOrigin(value as string | null | undefined), String(value)).toBeNull();
    }
  });

  it("never matches by suffix, prefix, substring or wildcard", () => {
    expect(originsMatch(PRODUCTION_ORIGIN, PRODUCTION_ORIGIN)).toBe(true);
    for (const other of [
      INCIDENT_PREVIEW_ORIGIN,
      "https://forever.phuketre22.workers.dev.evil.test",
      "https://evil-forever.phuketre22.workers.dev",
      "https://forever.phuketre22.workers.dev.",
      "https://phuketre22.workers.dev",
      "https://*.workers.dev",
      "http://forever.phuketre22.workers.dev",
      "https://forever.phuketre22.workers.dev:8443",
    ]) {
      expect(originsMatch(other, PRODUCTION_ORIGIN), other).toBe(false);
    }
    // Two unknowns are not a match.
    expect(originsMatch(null, null)).toBe(false);
    expect(originsMatch("not-an-origin", "not-an-origin")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The server boundary — which requests are allowed
// ---------------------------------------------------------------------------

describe("the server upload-origin boundary", () => {
  it("allows the exact production origin", () => {
    expect(refusalFor(requestFrom(PRODUCTION_ORIGIN))).toBeNull();
    // A same-origin Referer is corroboration, not an obstacle.
    expect(
      refusalFor(requestFrom(PRODUCTION_ORIGIN, { referer: `${PRODUCTION_ORIGIN}/studio/upload` })),
    ).toBeNull();
  });

  it("refuses the exact version preview the incident happened on", () => {
    const refusal = refusalFor(requestFrom(INCIDENT_PREVIEW_ORIGIN));
    expect(refusal?.name).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
    expect(refusal?.message).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_MESSAGE);
  });

  it("refuses arbitrary version-preview origins", () => {
    for (const preview of [
      "https://00000000-forever.phuketre22.workers.dev",
      "https://deadbeef-forever.phuketre22.workers.dev",
      "https://ebe99b50-forever.someone-else.workers.dev",
      "https://forever-preview.phuketre22.workers.dev",
    ]) {
      expect(refusalFor(requestFrom(preview))?.name, preview).toBe(
        STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
      );
    }
  });

  it("refuses a lookalike or suffix origin", () => {
    for (const lookalike of [
      "https://forever.phuketre22.workers.dev.evil.test",
      "https://evil.test/forever.phuketre22.workers.dev",
      "https://xforever.phuketre22.workers.dev",
      "https://phuketre22.workers.dev",
    ]) {
      expect(refusalFor(requestFrom(lookalike))?.name, lookalike).toBe(
        STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
      );
    }
  });

  it("refuses an http/https mismatch", () => {
    expect(refusalFor(requestFrom("http://forever.phuketre22.workers.dev"))?.name).toBe(
      STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
    );
    // ...and the mirror case: an https request against an http deployment.
    expect(
      refusalFor(requestFrom(PRODUCTION_ORIGIN), {
        FOREVER_SITE_ORIGIN: "http://forever.phuketre22.workers.dev",
      } as NodeJS.ProcessEnv)?.name,
    ).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
  });

  it("refuses an explicit port mismatch", () => {
    for (const ported of [
      "https://forever.phuketre22.workers.dev:8443",
      "https://forever.phuketre22.workers.dev:80",
      "https://forever.phuketre22.workers.dev:3000",
    ]) {
      expect(refusalFor(requestFrom(ported))?.name, ported).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
    }
    // An explicitly ported deployment is refused by an unported request too.
    const portedEnv = { FOREVER_SITE_ORIGIN: "http://localhost:3000" } as NodeJS.ProcessEnv;
    expect(refusalFor(requestFrom("http://localhost"), portedEnv)?.name).toBe(
      STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
    );
    expect(refusalFor(requestFrom("http://localhost:3000"), portedEnv)).toBeNull();
  });

  it("refuses a missing, malformed or contradictory request origin", () => {
    // No request context at all.
    expect(refusalFor(null)?.name).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
    // No Origin header.
    expect(refusalFor(requestFrom(null))?.name).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
    // Present but not an origin.
    for (const malformed of [
      "null",
      "",
      "   ",
      "forever.phuketre22.workers.dev",
      `${PRODUCTION_ORIGIN}/studio/upload`,
      `${PRODUCTION_ORIGIN}, ${INCIDENT_PREVIEW_ORIGIN}`,
    ]) {
      expect(refusalFor(requestFrom(malformed))?.name, JSON.stringify(malformed)).toBe(
        STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
      );
    }
    // An allowed Origin contradicted by a Referer from somewhere else.
    expect(
      refusalFor(
        requestFrom(PRODUCTION_ORIGIN, { referer: `${INCIDENT_PREVIEW_ORIGIN}/studio/upload` }),
      )?.name,
    ).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
  });

  it("consults the request, never the request body", () => {
    // Every field here is browser-controlled. A server that read any of them
    // would be taking the uploader's word for whether the uploader may upload.
    const body = JSON.stringify({
      origin: PRODUCTION_ORIGIN,
      Origin: PRODUCTION_ORIGIN,
      siteOrigin: PRODUCTION_ORIGIN,
      uploadOriginAllowed: true,
    });
    const forged = new Request(`${PRODUCTION_ORIGIN}/_serverFn/studioStartJob`, {
      method: "POST",
      headers: { origin: INCIDENT_PREVIEW_ORIGIN, "content-type": "application/json" },
      body,
    });
    expect(refusalFor(forged)?.name).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
  });

  it("fails closed when the deployment declares an unusable origin", () => {
    // A value that is present but not an origin is a BROKEN deployment
    // variable. It is never repaired into something plausible and never
    // treated as "allow anything": it resolves to null, and null allows
    // nothing at all — not even the real production origin.
    for (const configured of [
      "not-an-origin",
      "*",
      "https://*.workers.dev",
      "/studio",
      "https://",
    ]) {
      const env = { FOREVER_SITE_ORIGIN: configured } as NodeJS.ProcessEnv;
      expect(resolveExpectedUploadOrigin(env), configured).toBeNull();
      expect(refusalFor(requestFrom(PRODUCTION_ORIGIN), env)?.name, configured).toBe(
        STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
      );
    }
  });

  it("resolves the expected origin from one declared precedence", () => {
    expect(
      resolveExpectedUploadOrigin({ FOREVER_SITE_ORIGIN: PRODUCTION_ORIGIN } as NodeJS.ProcessEnv),
    ).toBe(PRODUCTION_ORIGIN);
    expect(
      resolveExpectedUploadOrigin({
        FOREVER_SITE_ORIGIN: "https://a.example",
        VITE_PUBLIC_SITE_ORIGIN: "https://b.example",
      } as NodeJS.ProcessEnv),
    ).toBe("https://a.example");
    expect(
      resolveExpectedUploadOrigin({
        VITE_PUBLIC_SITE_ORIGIN: "https://b.example",
      } as NodeJS.ProcessEnv),
    ).toBe("https://b.example");
    // Nothing declared in the RUNTIME environment falls back to the origin this
    // BUILD carries — the same value the browser compares against — and never
    // to "any". That last tier is the one that keeps the two halves of the
    // guard agreeing: `VITE_PUBLIC_SITE_ORIGIN` is inlined at build time and
    // never reaches a deployed Worker's process.env, so falling back to the
    // bare default here would let a build configured for one origin be policed
    // by a server expecting another, and refuse every real upload.
    expect(resolveExpectedUploadOrigin({} as NodeJS.ProcessEnv)).toBe(PUBLIC_SITE_ORIGIN);
    // And the compiled-in default is the live production origin.
    expect(DEFAULT_PUBLIC_SITE_ORIGIN).toBe(PRODUCTION_ORIGIN);
  });

  it("agrees with the browser on the same build, whatever that build was configured with", () => {
    // The property that matters, stated directly: with no runtime variable set,
    // whatever origin the browser will allow is exactly the origin the server
    // will accept. A build for a custom domain must not render an uploader the
    // server then refuses.
    const expected = resolveExpectedUploadOrigin({} as NodeJS.ProcessEnv);
    expect(expected).not.toBeNull();
    expect(isStudioUploadOriginAllowed(PUBLIC_SITE_ORIGIN, PUBLIC_SITE_ORIGIN)).toBe(true);
    expect(refusalFor(requestFrom(PUBLIC_SITE_ORIGIN), {} as NodeJS.ProcessEnv)).toBeNull();
    // ...and the incident preview is still refused on that same build.
    expect(refusalFor(requestFrom(INCIDENT_PREVIEW_ORIGIN), {} as NodeJS.ProcessEnv)?.name).toBe(
      STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
    );
  });

  it("says nothing about the request in what crosses to the browser", () => {
    const refusal = refusalFor(
      requestFrom(INCIDENT_PREVIEW_ORIGIN, { referer: `${INCIDENT_PREVIEW_ORIGIN}/studio/upload` }),
    );
    const surfaced = `${refusal?.name} ${refusal?.message}`;
    for (const forbidden of [
      "ebe99b50",
      "workers.dev",
      "preflight",
      "CORS",
      "R2",
      "bucket",
      "forever-private-sources",
      "https://",
      "Referer",
      "referer",
      "header",
    ]) {
      expect(surfaced, `refusal must not contain ${forbidden}`).not.toContain(forbidden);
    }
    expect(refusal?.name).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
    expect((refusal as { retryable?: boolean }).retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Negative controls — a refused request allocates NOTHING
// ---------------------------------------------------------------------------

function r2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

/** Everything a refused upload request must NOT have created. */
function allocationCensus(world: FakeWorld) {
  return {
    jobs: world.data.jobs.size,
    archives: world.data.archives.size,
    archiveEntries: world.data.archiveEntries.size,
    audits: world.data.audits.length,
    supabaseObjects: world.storage.objects.size,
    supabaseSignedUploads: world.storage.signedUploads.length,
    privateR2Objects: world.r2.keys(TEST_R2_BUCKETS.privateSources).length,
    archiveR2Objects: world.r2.keys(TEST_R2_BUCKETS.projectArchives).length,
    multipartUploads: world.r2.uploads.size,
  };
}

/**
 * The ACTUAL endpoint composition, minus the framework.
 *
 * `studio.functions.ts` runs `requireStudioUploadOrigin` — which resolves the
 * live request and then calls `assertStudioUploadOrigin` — and only then calls
 * the service function. This runs the same two steps in the same order against
 * an explicit request, so a refusal here is a refusal there. That the endpoints
 * really are wired this way is pinned separately, from source, below.
 */
async function guardedUpload<T>(request: Request | null, run: () => Promise<T>): Promise<T> {
  assertStudioUploadOrigin(request, PRODUCTION_ENV);
  return run();
}

/** Spies on the two functions that would allocate something. */
function watchAllocation(world: FakeWorld) {
  const createJob = vi.spyOn(world.data, "createJob");
  const createArchive = vi.spyOn(world.data, "createArchive");
  const provider = world.deps.storageProviders.get("r2");
  const allocateOrdinaryUpload = vi.spyOn(provider, "allocateOrdinaryUpload");
  const beginArchiveUpload = vi.spyOn(provider, "beginArchiveUpload");
  const archivePartTargets = vi.spyOn(provider, "archivePartTargets");
  return {
    createJob,
    createArchive,
    allocateOrdinaryUpload,
    beginArchiveUpload,
    archivePartTargets,
  };
}

const THREE_FILES = [
  { name: "material-01.jpg", materialPurpose: "project_photo" as const },
  { name: "material-02.jpg", materialPurpose: "project_photo" as const },
  { name: "material-03.pdf", materialPurpose: "brochure" as const },
];

describe("a refused ordinary upload allocates nothing", () => {
  it("creates no job row, no audit entry and no presigned target", async () => {
    const world = r2World();
    const before = allocationCensus(world);
    const spies = watchAllocation(world);

    await expect(
      guardedUpload(requestFrom(INCIDENT_PREVIEW_ORIGIN), () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          projectFacts: { name: "Preview Origin Attempt" },
          files: THREE_FILES.map((file) => ({ ...file })),
        }),
      ),
    ).rejects.toMatchObject({ name: STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE });

    expect(allocationCensus(world)).toEqual(before);
    expect(before.jobs).toBe(0);
    expect(before.audits).toBe(0);
    // The allocation functions were never reached at all.
    expect(spies.createJob).not.toHaveBeenCalled();
    expect(spies.allocateOrdinaryUpload).not.toHaveBeenCalled();
  });

  it("refuses the incident's second job — project_update, one file — identically", async () => {
    const world = r2World();
    const before = allocationCensus(world);
    const spies = watchAllocation(world);

    await expect(
      guardedUpload(requestFrom(INCIDENT_PREVIEW_ORIGIN), () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "project_update",
          projectSlug: "title-sierra",
          files: [{ name: "update-01.pdf", materialPurpose: "price_list" }],
        }),
      ),
    ).rejects.toMatchObject({ name: STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE });

    expect(allocationCensus(world)).toEqual(before);
    expect(spies.createJob).not.toHaveBeenCalled();
    expect(spies.allocateOrdinaryUpload).not.toHaveBeenCalled();
  });

  it("refuses a request with no origin at all before any allocation", async () => {
    const world = r2World();
    const before = allocationCensus(world);
    const spies = watchAllocation(world);

    for (const request of [null, requestFrom(null)]) {
      await expect(
        guardedUpload(request, () =>
          startUploadJob(world.deps, OWNER, {
            workflow: "new_development",
            files: THREE_FILES.map((file) => ({ ...file })),
          }),
        ),
      ).rejects.toMatchObject({ name: STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE });
    }

    expect(allocationCensus(world)).toEqual(before);
    expect(spies.createJob).not.toHaveBeenCalled();
    expect(spies.allocateOrdinaryUpload).not.toHaveBeenCalled();
  });
});

describe("a refused archive upload allocates nothing", () => {
  /** One production-origin job, so plan and confirm are actually reachable. */
  async function productionJob(world: FakeWorld) {
    return guardedUpload(requestFrom(PRODUCTION_ORIGIN), () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Archive Host Job" },
        files: THREE_FILES.map((file) => ({ ...file })),
      }),
    );
  }

  it("creates no archive row, no multipart upload and no signed part target", async () => {
    const world = r2World();
    const started = await productionJob(world);
    const before = allocationCensus(world);
    const spies = watchAllocation(world);

    await expect(
      guardedUpload(requestFrom(INCIDENT_PREVIEW_ORIGIN), () =>
        planJobArchiveUpload(world.deps, OWNER, {
          jobId: started.jobId,
          fileName: "package.zip",
          declaredSize: 32 * 1024 * 1024,
          materialPurpose: "project_archive",
          partSha256: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)],
        }),
      ),
    ).rejects.toMatchObject({ name: STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE });

    expect(allocationCensus(world)).toEqual(before);
    expect(before.archives).toBe(0);
    expect(before.multipartUploads).toBe(0);
    expect(spies.createArchive).not.toHaveBeenCalled();
    expect(spies.beginArchiveUpload).not.toHaveBeenCalled();
    expect(spies.archivePartTargets).not.toHaveBeenCalled();
  });

  it("refuses confirmation on the same terms", async () => {
    const world = r2World();
    const started = await productionJob(world);
    const before = allocationCensus(world);

    await expect(
      guardedUpload(requestFrom(INCIDENT_PREVIEW_ORIGIN), () =>
        confirmJobArchiveUpload(world.deps, OWNER, {
          jobId: started.jobId,
          archiveId: "00000000-0000-4000-8000-000000000002",
          partSha256: ["a".repeat(64)],
        }),
      ),
    ).rejects.toMatchObject({ name: STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE });

    expect(allocationCensus(world)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 4. The production origin still works, ordinary and archive alike
// ---------------------------------------------------------------------------

describe("production-origin uploads are completely unaffected", () => {
  it("allocates a job and one signed target per ordinary file", async () => {
    const world = r2World();

    const started = await guardedUpload(requestFrom(PRODUCTION_ORIGIN), () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Production Origin" },
        files: THREE_FILES.map((file) => ({ ...file })),
      }),
    );

    expect(started.uploads).toHaveLength(3);
    expect(world.data.jobs.size).toBe(1);
    for (const upload of started.uploads) {
      expect(upload.transport?.kind).toBe("r2_presigned_put");
    }
  });

  it("plans and resumes a large archive normally", async () => {
    const world = r2World();
    const started = await guardedUpload(requestFrom(PRODUCTION_ORIGIN), () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Production Archive" },
        files: [],
      }),
    );

    const partSha256 = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)];
    const plan = await guardedUpload(requestFrom(PRODUCTION_ORIGIN), () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        fileName: "package.zip",
        declaredSize: 32 * 1024 * 1024,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );

    expect(plan.archiveId).toBeTruthy();
    expect(plan.partCount).toBeGreaterThan(0);
    expect(plan.parts).toHaveLength(plan.partCount);
    expect(world.data.archives.size).toBe(1);
    expect(world.r2.uploads.size).toBe(1);

    // And a replan of the identical manifest resumes the same archive.
    const replan = await guardedUpload(requestFrom(PRODUCTION_ORIGIN), () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        fileName: "package.zip",
        declaredSize: 32 * 1024 * 1024,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    expect(replan.archiveId).toBe(plan.archiveId);
    expect(world.data.archives.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. The browser: no upload interface on a preview
// ---------------------------------------------------------------------------

const BASE_OVERVIEW = {
  session: { role: "owner", email: "owner@example.com", displayName: "Owner" },
  projects: [],
  listings: [],
  jobs: [],
  members: [],
  activeJobs: 0,
  capabilities: { archiveUpload: "available" as const },
};

function renderUploader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const uploadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/upload",
    component: () => <StudioUploader workflow="new_development" />,
  });
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio",
    component: () => <p>Studio dashboard</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([studioRoute, uploadRoute]),
    history: createMemoryHistory({ initialEntries: ["/studio/upload"] }),
  });
  return render(<RouterProvider router={router} />);
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the uploader on an origin it may not upload from", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(BASE_OVERVIEW);
    endpoints.startJob.mockReset();
    endpoints.planArchive.mockReset();
    endpoints.confirmArchive.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("renders no upload window, no picker and no submit on the incident preview", async () => {
    setBrowserOrigin(INCIDENT_PREVIEW_ORIGIN);
    renderUploader();
    await settle();

    // Not one of the fourteen windows, and no way to start anything.
    for (const window of STUDIO_MATERIAL_WINDOWS) {
      expect(
        screen.queryByLabelText(window.label, { selector: 'input[type="file"]' }),
        window.label,
      ).toBeNull();
    }
    expect(screen.queryByTestId("studio-upload-submit")).toBeNull();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(document.querySelectorAll("form")).toHaveLength(0);
    // Nothing was even attempted.
    expect(endpoints.startJob).not.toHaveBeenCalled();
    expect(endpoints.planArchive).not.toHaveBeenCalled();
  });

  it("says what is disabled and why, without claiming Forever is broken", async () => {
    setBrowserOrigin(INCIDENT_PREVIEW_ORIGIN);
    renderUploader();
    await settle();

    expect(screen.getByText(STUDIO_UPLOAD_PREVIEW_TITLE)).toBeTruthy();
    const note = screen.getByText(STUDIO_UPLOAD_PREVIEW_NOTE);
    expect(note.getAttribute("role")).toBe("status");
    expect(STUDIO_UPLOAD_PREVIEW_NOTE.toLowerCase()).toContain("nothing here is broken");
    // No storage, credential or infrastructure detail in the copy.
    const copy = `${STUDIO_UPLOAD_PREVIEW_TITLE} ${STUDIO_UPLOAD_PREVIEW_NOTE}`;
    for (const forbidden of [
      "R2",
      "Cloudflare",
      "CORS",
      "preflight",
      "bucket",
      "presigned",
      "workers.dev",
      "403",
      "Supabase",
    ]) {
      expect(copy, `copy must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("links to the equivalent route on the production origin, never to itself", async () => {
    setBrowserOrigin(INCIDENT_PREVIEW_ORIGIN);
    renderUploader();
    await settle();

    const link = screen.getByText(STUDIO_UPLOAD_PREVIEW_LINK_LABEL) as HTMLAnchorElement;
    // The destination comes from the BUILD's configured origin, never from the
    // preview the page is open on.
    expect(link.getAttribute("href")).toBe(`${PUBLIC_SITE_ORIGIN}/studio/upload`);
    expect(link.getAttribute("href")).not.toContain("ebe99b50");
    // Read-only inspection of this preview stays one click away.
    expect(screen.getByText("Back to Studio")).toBeTruthy();
  });

  it("preserves a safe Studio pathname and drops everything else", () => {
    expect(studioProductionUrl(PRODUCTION_ORIGIN, "/studio/upload")).toBe(
      `${PRODUCTION_ORIGIN}/studio/upload`,
    );
    expect(studioProductionUrl(PRODUCTION_ORIGIN, "/studio/project/coralina")).toBe(
      `${PRODUCTION_ORIGIN}/studio/project/coralina`,
    );
    expect(studioProductionUrl(PRODUCTION_ORIGIN, "/studio")).toBe(`${PRODUCTION_ORIGIN}/studio`);
    // Anything that is not recognisably a Studio route falls back.
    for (const unsafe of [
      "//evil.test/studio/upload",
      "/studio/../../etc/passwd",
      "/studio/./upload",
      "/studio//upload",
      "/studio/.hidden",
      "/studiox/hack",
      "https://evil.test/studio/upload",
      "/projects/coralina",
      "/studio/upload?token=abc",
      "/studio/upload#fragment",
      "/studio/upload%2f..%2f",
      "studio/upload",
      "",
      null,
    ]) {
      expect(studioProductionUrl(PRODUCTION_ORIGIN, unsafe), String(unsafe)).toBe(
        `${PRODUCTION_ORIGIN}/studio/upload`,
      );
    }
    // No usable production origin means no link at all, never a broken one.
    expect(studioProductionUrl(null, "/studio/upload")).toBeNull();
    expect(studioProductionUrl("not-an-origin", "/studio/upload")).toBeNull();
  });

  it("renders the normal upload form on the production origin", async () => {
    setBrowserOrigin(PUBLIC_SITE_ORIGIN);
    renderUploader();
    await settle();

    expect(screen.getByTestId("studio-upload-submit")).toBeTruthy();
    expect(screen.queryByText(STUDIO_UPLOAD_PREVIEW_TITLE)).toBeNull();
    for (const window of STUDIO_MATERIAL_WINDOWS) {
      expect(
        screen.getByLabelText(window.label, { selector: 'input[type="file"]' }),
        window.label,
      ).toBeTruthy();
    }
  });

  it("fails closed in the browser too: an unknown location renders no uploader", () => {
    expect(isStudioUploadOriginAllowed(null, PRODUCTION_ORIGIN)).toBe(false);
    expect(isStudioUploadOriginAllowed(undefined, PRODUCTION_ORIGIN)).toBe(false);
    expect(isStudioUploadOriginAllowed(PRODUCTION_ORIGIN, null)).toBe(false);
    expect(isStudioUploadOriginAllowed(INCIDENT_PREVIEW_ORIGIN, PRODUCTION_ORIGIN)).toBe(false);
    expect(isStudioUploadOriginAllowed(PRODUCTION_ORIGIN, PRODUCTION_ORIGIN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Wiring, bundle boundary and the safe-error contract
// ---------------------------------------------------------------------------

describe("the guard is wired where allocation happens, and nowhere it does not belong", () => {
  const read = async (path: string) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    return readFileSync(resolve(process.cwd(), path), "utf8");
  };

  it("every upload-allocation endpoint calls the guard before its service call", async () => {
    const functions = await read("src/features/forever-studio/studio.functions.ts");
    const guarded = [
      { endpoint: "studioStartJob", service: "startUploadJob(context.deps" },
      { endpoint: "studioPlanArchiveUpload", service: "planJobArchiveUpload(context.deps" },
      { endpoint: "studioConfirmArchiveUpload", service: "confirmJobArchiveUpload(context.deps" },
    ];
    for (const { endpoint, service } of guarded) {
      const start = functions.indexOf(`export const ${endpoint} =`);
      expect(start, endpoint).toBeGreaterThan(-1);
      const body = functions.slice(start, functions.indexOf("export const ", start + 1));
      const guardAt = body.indexOf("await requireStudioUploadOrigin()");
      const serviceAt = body.indexOf(service);
      expect(guardAt, `${endpoint} must call the origin guard`).toBeGreaterThan(-1);
      expect(serviceAt, `${endpoint} must call ${service}`).toBeGreaterThan(-1);
      expect(guardAt, `${endpoint} must guard BEFORE allocating`).toBeLessThan(serviceAt);
    }
    // Exactly the three allocation endpoints, so the guard has not silently
    // spread onto reads and closed a preview that must stay inspectable.
    expect((functions.match(/await requireStudioUploadOrigin\(\)/g) ?? []).length).toBe(3);
    // And the existing membership guard is untouched on every endpoint.
    const serverFnCount = (functions.match(/createServerFn\(/g) ?? []).length;
    expect((functions.match(/\.middleware\(\[requireStudioMember\]\)/g) ?? []).length).toBe(
      serverFnCount,
    );
  });

  it("the server module is reached only through a dynamic import", async () => {
    const clientReachable = [
      "src/features/forever-studio/studio.functions.ts",
      "src/features/forever-studio/studio-auth.ts",
      "src/features/forever-studio/studio-upload-origin.ts",
      "src/features/forever-studio/components/StudioUploader.tsx",
      "src/lib/site-origin.ts",
      "src/lib/sitemap.ts",
    ];
    for (const path of clientReachable) {
      const source = await read(path);
      expect(source, path).not.toMatch(/^import .*upload-origin\.server/m);
      expect(source, path).not.toContain("FOREVER_SITE_ORIGIN");
      expect(source, path).not.toContain("process.env");
    }
    const functions = await read("src/features/forever-studio/studio.functions.ts");
    expect(functions).toMatch(/await import\("\.\/server\/upload-origin\.server"\)/);
  });

  it("the client-safe contract module reaches no server module and holds no secret", async () => {
    const source = await read("src/features/forever-studio/studio-upload-origin.ts");
    expect(source).not.toMatch(/^import .*\.server/m);
    expect(source).not.toMatch(/^import .*\/server\//m);
    for (const forbidden of [
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "forever-private-sources",
      "cloudflarestorage",
      "AWS4-HMAC-SHA256",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("the refusal is a StudioAccessError, so the safe envelope passes it through", async () => {
    const { runStudioEndpoint } = await import("../server/errors");
    const { StudioAccessError } = await import("../server/contracts");

    const thrown = await runStudioEndpoint("upload_start", async () => {
      assertStudioUploadOrigin(requestFrom(INCIDENT_PREVIEW_ORIGIN), PRODUCTION_ENV);
    }).then(
      () => null,
      (error: Error) => error,
    );

    expect(thrown).toBeInstanceOf(StudioAccessError);
    // The envelope did not collapse it into the generic failure: the browser
    // settles on this exact code rather than retrying forever.
    expect(thrown!.name).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE);
    expect(thrown!.message).toBe(STUDIO_UPLOAD_ORIGIN_REFUSAL_MESSAGE);
  });
});
