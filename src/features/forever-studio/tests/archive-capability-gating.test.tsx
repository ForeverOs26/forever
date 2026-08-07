/**
 * FOREVER-PR134-ORDINARY-R2-RECOVERY-SCOPE-CORRECTION-001 — gating the
 * resumable archive lane without touching anything else.
 *
 * THE DECISION THIS PINS
 * ----------------------
 * Worker-side R2 processing is corrected and the contained production job is
 * recoverable. The ONE thing that is not corrected is the resumable
 * large-archive lane: it needs an authoritative list of the parts storage
 * durably holds, and a Worker's R2 bindings cannot produce one. Rather than
 * hold the recovery hostage to that, the archive lane is declared unavailable
 * — explicitly, visibly, and before anything is allocated.
 *
 * "Explicitly" is the whole point, and it is what these tests are for:
 *
 *   - the window is NOT hidden. All fourteen still render, and the archive one
 *     still says what it is and why it cannot be used right now;
 *   - the picker is NOT left enabled to fail later. It is disabled, described,
 *     and refuses a programmatic change event too;
 *   - the client is NOT the boundary. Every archive endpoint re-derives the
 *     answer from the provider that would have to do the work, so a forged
 *     capability, a stale bundle or a raw HTTP call all get the same refusal;
 *   - the refusal precedes EVERY allocation — no job row, no archive row, no
 *     signed part target, no multipart upload, no stored object;
 *   - a mixed submission is one thing. It does not half-create the ordinary
 *     job and then discover the archive cannot go;
 *   - and the ordinary six-file Coralina-equivalent recovery is completely
 *     unaffected, which is the reason for doing any of this.
 *
 * Nothing here contacts production, staging or real R2.
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
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getOverview: vi.fn(),
  startJob: vi.fn(),
  processJob: vi.fn(),
  planArchive: vi.fn(),
  confirmArchive: vi.fn(),
}));

const archiveLane = vi.hoisted(() => ({ uploadLargeArchive: vi.fn() }));

vi.mock("../components/archive-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/archive-upload")>();
  return {
    ...actual,
    uploadLargeArchive: archiveLane.uploadLargeArchive,
    // The TRANSPORT test only: any .zip counts as large here, so a lane
    // decision can be isolated from a file size in a jsdom test.
    isLargeArchive: (file: File) => file.name.endsWith(".zip"),
    archiveTooLarge: () => false,
  };
});

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

import { StudioUploader } from "../components/StudioUploader";
import {
  ARCHIVE_UPLOAD_UNAVAILABLE_CODE,
  ARCHIVE_UPLOAD_UNAVAILABLE_MESSAGE,
  ARCHIVE_UPLOAD_UNAVAILABLE_WINDOW_NOTE,
  isArchiveUploadAvailable,
  isArchiveUploadDisplayedUnavailable,
  STUDIO_ARCHIVE_UPLOAD_CAPABILITIES,
  type StudioArchiveUploadCapability,
} from "../archive-capability";
import {
  confirmJobArchiveUpload,
  getOverview,
  planJobArchiveUpload,
  processUploadJob,
  startUploadJob,
} from "../server/service";
import { STUDIO_MATERIAL_WINDOWS } from "../studio-types";
import { assertLocalR2Endpoint } from "./local-r2";
import { withWorkerRuntime } from "./local-r2-binding";
import { withProductionUploadOrigin } from "./upload-origin-fixture";
import { makeWorld, OWNER, TEST_R2_BUCKETS, uploadAllViaTransport, type FakeWorld } from "./fakes";

// The uploader renders an upload interface only on the declared production
// origin (Issue #103), so these suites run on it.
withProductionUploadOrigin();

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

/** Production's shape: R2 write provider on a Cloudflare Worker. */
function workerR2World(): FakeWorld {
  const world = makeWorld({ r2Runtime: "worker" });
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

/** R2 off a Worker — local development and the existing archive suites. */
function nodeR2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

/** The sanitized Coralina-equivalent manifest: six ordinary files, no archive. */
const CORALINA_EQUIVALENT_MANIFEST = [
  { name: "material-01.jpg", materialPurpose: "project_photo" as const },
  { name: "material-02.jpg", materialPurpose: "project_photo" as const },
  { name: "material-03.jpg", materialPurpose: "project_photo" as const },
  { name: "material-04.pdf", materialPurpose: "brochure" as const },
  { name: "material-05.pdf", materialPurpose: "price_list" as const },
  { name: "material-06.pdf", materialPurpose: "developer_profile" as const },
];

/** Everything a refused archive request must NOT have created. */
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
    publicR2Objects: world.r2.keys(TEST_R2_BUCKETS.publicMedia).length,
    multipartUploads: world.r2.uploads.size,
    projects: world.executor.store.projects.length,
  };
}

// ---------------------------------------------------------------------------
// 1–6, 20 — the archive window and the client capability
// ---------------------------------------------------------------------------

const BASE_OVERVIEW = {
  session: { role: "owner", email: "owner@example.com", displayName: "Owner" },
  projects: [],
  listings: [],
  jobs: [],
  members: [],
  activeJobs: 0,
};

function overviewWith(capability: StudioArchiveUploadCapability) {
  return { ...BASE_OVERVIEW, capabilities: { archiveUpload: capability } };
}

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

const ARCHIVE_LABEL = "Full Project Archive / Other Package";

function windowInput(label: string): HTMLInputElement {
  const input = screen.getByLabelText(label, { selector: 'input[type="file"]' });
  if (!(input instanceof HTMLInputElement)) throw new Error(`no picker for ${label}`);
  return input;
}

async function addTo(label: string, ...files: File[]) {
  await act(async () => {
    fireEvent.change(windowInput(label), { target: { files } });
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the archive window when the resumable lane is unavailable", () => {
  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(overviewWith("temporarily_unavailable"));
    endpoints.startJob.mockReset().mockResolvedValue({ jobId: "job-1", uploads: [] });
    endpoints.processJob.mockReset().mockResolvedValue({
      jobId: "job-1",
      status: "published",
      warnings: [],
      counts: null,
      pagePath: null,
    });
    endpoints.planArchive.mockReset();
    endpoints.confirmArchive.mockReset();
    archiveLane.uploadLargeArchive.mockReset().mockResolvedValue({ archiveId: "arch-1" });
  });

  it("(1) still renders all fourteen material windows", async () => {
    renderUploader();
    await settle();

    expect(STUDIO_MATERIAL_WINDOWS).toHaveLength(14);
    for (const window of STUDIO_MATERIAL_WINDOWS) {
      expect(windowInput(window.label), window.label).toBeTruthy();
    }
    // The archive window is present, named, and NOT hidden.
    expect(screen.getByText(ARCHIVE_LABEL)).toBeTruthy();
  });

  it("(2) leaves the other thirteen windows enabled", async () => {
    renderUploader();
    await settle();

    const ordinary = STUDIO_MATERIAL_WINDOWS.filter(
      (window) => window.purpose !== "project_archive",
    );
    expect(ordinary).toHaveLength(13);
    for (const window of ordinary) {
      expect(windowInput(window.label).disabled, window.label).toBe(false);
    }
    // And they still accept files.
    await addTo("Brochure", new File(["b"], "brochure.pdf", { type: "application/pdf" }));
    expect(screen.getByText("brochure.pdf")).toBeTruthy();
  });

  it("(3) marks the archive window visibly unavailable, with its reason", async () => {
    renderUploader();
    await settle();

    const input = windowInput(ARCHIVE_LABEL);
    expect(input.disabled).toBe(true);
    // The reason is part of the control's accessible description, not just
    // decoration sitting somewhere nearby.
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const note = screen.getByText(ARCHIVE_UPLOAD_UNAVAILABLE_WINDOW_NOTE);
    expect(describedBy.split(" ")).toContain(note.id);
    expect(note.getAttribute("role")).toBe("status");
  });

  it("(4) refuses a selection through the disabled picker", async () => {
    renderUploader();
    await settle();

    await addTo(ARCHIVE_LABEL, new File(["z"], "package.zip", { type: "application/zip" }));

    // Nothing was taken into the form, and the window still explains itself.
    expect(screen.queryByText("package.zip")).toBeNull();
    expect(windowInput(ARCHIVE_LABEL).disabled).toBe(true);
  });

  it("(5) explains itself without leaking any implementation detail", async () => {
    renderUploader();
    await settle();
    const copy = `${ARCHIVE_UPLOAD_UNAVAILABLE_WINDOW_NOTE} ${ARCHIVE_UPLOAD_UNAVAILABLE_MESSAGE}`;

    for (const forbidden of [
      "R2",
      "r2",
      "Cloudflare",
      "Worker",
      "worker",
      "binding",
      "bucket",
      "S3",
      "ListParts",
      "multipart",
      "Supabase",
      "supabase",
      "provider",
      "runtime",
      "credential",
      "http",
      "/",
    ]) {
      expect(copy, `copy must not mention ${forbidden}`).not.toContain(forbidden);
    }
    // It still tells the Owner the two things that matter.
    expect(copy.toLowerCase()).toContain("temporarily unavailable");
    expect(copy.toLowerCase()).toContain("every other");
  });

  it("(6) a client that claims the lane is open still cannot start one", async () => {
    // The browser is handed "available" and the picker is duly enabled — this
    // is exactly the shape of a forged capability or a stale cached overview.
    endpoints.getOverview.mockReset().mockResolvedValue(overviewWith("available"));
    renderUploader();
    await settle();
    expect(windowInput(ARCHIVE_LABEL).disabled).toBe(false);

    // The SERVER refuses anyway, because it never asked the client.
    const world = workerR2World();
    const before = allocationCensus(world);
    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          projectFacts: { name: "Forged Capability" },
          files: [],
          archives: [{ name: "package.zip", size: 999, materialPurpose: "project_archive" }],
        }),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });
    expect(allocationCensus(world)).toEqual(before);
  });

  it("(6) a request that carries its own capability claim is refused all the same", async () => {
    // Every field below is browser-controlled. A server that consulted ANY of
    // them would be taking the uploader's word for whether the uploader may
    // upload. The capability is re-derived from the provider instead, so these
    // are simply ignored — and the refusal is identical with or without them.
    const world = workerR2World();
    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Client Override Attempt" },
        files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
      }),
    );
    const before = allocationCensus(world);

    const forged = {
      jobId: started.jobId,
      fileName: "package.zip",
      declaredSize: 32 * 1024 * 1024,
      materialPurpose: "project_archive" as const,
      partSha256: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)],
      // The lies.
      archiveUploadCapability: "available",
      capabilities: { archiveUpload: "available" },
      archiveControlPlane: "available",
      runtime: "node",
      provider: "supabase",
    };

    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        planJobArchiveUpload(
          world.deps,
          OWNER,
          forged as unknown as Parameters<typeof planJobArchiveUpload>[2],
        ),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });

    expect(allocationCensus(world)).toEqual(before);

    // And the same claim on start-job buys nothing either.
    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          files: [],
          archives: [{ name: "package.zip", size: 4096, materialPurpose: "project_archive" }],
          capabilities: { archiveUpload: "available" },
        } as unknown as Parameters<typeof startUploadJob>[2]),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });
    expect(world.data.jobs.size).toBe(1);
  });

  it("the capability vocabulary is closed, and absence is not permission", () => {
    expect([...STUDIO_ARCHIVE_UPLOAD_CAPABILITIES].sort()).toEqual([
      "available",
      "temporarily_unavailable",
    ]);
    // Submitting on an unknown capability must not start an upload...
    expect(isArchiveUploadAvailable(undefined)).toBe(false);
    expect(isArchiveUploadAvailable("temporarily_unavailable")).toBe(false);
    expect(isArchiveUploadAvailable("available")).toBe(true);
    // ...but an unresolved query must not paint the window as unavailable.
    expect(isArchiveUploadDisplayedUnavailable(undefined)).toBe(false);
    expect(isArchiveUploadDisplayedUnavailable("temporarily_unavailable")).toBe(true);
  });
});

describe("the archive window when the resumable lane is available", () => {
  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(overviewWith("available"));
    endpoints.startJob.mockReset().mockResolvedValue({ jobId: "job-1", uploads: [] });
    endpoints.processJob.mockReset().mockResolvedValue({
      jobId: "job-1",
      status: "published",
      warnings: [],
      counts: null,
      pagePath: null,
    });
    archiveLane.uploadLargeArchive.mockReset().mockResolvedValue({ archiveId: "arch-1" });
  });

  it("is a normal, enabled window with no unavailable copy anywhere", async () => {
    renderUploader();
    await settle();

    expect(windowInput(ARCHIVE_LABEL).disabled).toBe(false);
    expect(screen.queryByText(ARCHIVE_UPLOAD_UNAVAILABLE_WINDOW_NOTE)).toBeNull();

    await addTo(ARCHIVE_LABEL, new File(["z"], "package.zip", { type: "application/zip" }));
    expect(screen.getByText("package.zip")).toBeTruthy();
  });

  it("(13) removing the archive lets the ordinary files publish normally", async () => {
    // Start from the unavailable deployment, with a mixed selection the Owner
    // built before the capability loaded.
    endpoints.getOverview.mockReset().mockResolvedValue(overviewWith("available"));
    renderUploader();
    await settle();
    await addTo("Brochure", new File(["b"], "brochure.pdf", { type: "application/pdf" }));
    await addTo(ARCHIVE_LABEL, new File(["z"], "package.zip", { type: "application/zip" }));
    expect(screen.getByText("package.zip")).toBeTruthy();

    // Remove ONLY the archive; the brochure and its window are untouched.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Remove package.zip from ${ARCHIVE_LABEL}` }),
      );
    });
    expect(screen.queryByText("package.zip")).toBeNull();
    expect(screen.getByText("brochure.pdf")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    });

    expect(endpoints.startJob).toHaveBeenCalledTimes(1);
    const sent = endpoints.startJob.mock.calls[0][0].data;
    expect(sent.files.map((file: { name: string }) => file.name)).toEqual(["brochure.pdf"]);
    expect(sent.archives ?? []).toEqual([]);
  });
});

describe("a mixed submission on a deployment without the resumable lane", () => {
  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(overviewWith("temporarily_unavailable"));
    endpoints.startJob.mockReset().mockResolvedValue({ jobId: "job-1", uploads: [] });
    endpoints.processJob.mockReset();
    archiveLane.uploadLargeArchive.mockReset();
  });

  it("(12) creates nothing at all, and keeps the Owner's whole selection", async () => {
    // THE RESIDUAL ROUTE, exercised for real.
    //
    // A never-settling overview is exactly the window in which the picker is
    // still enabled — the display question deliberately answers "not
    // unavailable" until the server has said so — while the submit question
    // already answers "closed". It is the one state in which an Owner can build
    // a mixed selection with the lane shut, and it is the only way to reach the
    // client's pre-submit refusal, so it is what this test drives.
    endpoints.getOverview.mockReset().mockReturnValue(new Promise(() => {}));
    renderUploader();
    await settle();
    expect(windowInput(ARCHIVE_LABEL).disabled).toBe(false);

    await addTo("Brochure", new File(["b"], "brochure.pdf", { type: "application/pdf" }));
    await addTo(ARCHIVE_LABEL, new File(["z"], "package.zip", { type: "application/zip" }));
    expect(screen.getByText("package.zip")).toBeTruthy();
    expect(screen.getByText("brochure.pdf")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    });

    // Nothing was created: no job, no ordinary upload, no archive call.
    expect(endpoints.startJob).not.toHaveBeenCalled();
    expect(archiveLane.uploadLargeArchive).not.toHaveBeenCalled();
    // Only the archive capability is named — not the brochure, not the form.
    expect(screen.getByText(ARCHIVE_UPLOAD_UNAVAILABLE_MESSAGE)).toBeTruthy();

    // And the Owner's whole selection survived. Going back to the form shows
    // both files still where they were put, so removing the archive is one
    // click and re-picking nothing.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back to the form" }));
    });
    expect(screen.getByText("package.zip")).toBeTruthy();
    expect(screen.getByText("brochure.pdf")).toBeTruthy();

    // Removing only the archive lets the ordinary half publish immediately.
    endpoints.getOverview.mockReset().mockResolvedValue(overviewWith("temporarily_unavailable"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Remove package.zip from ${ARCHIVE_LABEL}` }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    });

    expect(endpoints.startJob).toHaveBeenCalledTimes(1);
    const sent = endpoints.startJob.mock.calls[0][0].data;
    expect(sent.files.map((file: { name: string }) => file.name)).toEqual(["brochure.pdf"]);
    expect(sent.archives ?? []).toEqual([]);
  });

  it("(12) refuses the whole request server-side before any job row exists", async () => {
    const world = workerR2World();
    const before = allocationCensus(world);

    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          projectFacts: { name: "Mixed Submission" },
          files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
          archives: [{ name: "package.zip", size: 1024, materialPurpose: "project_archive" }],
        }),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });

    // Not one ordinary sibling was created, uploaded or allocated a target.
    expect(allocationCensus(world)).toEqual(before);
    expect(before.jobs).toBe(0);
  });

  it("accepts the identical submission once the archive is dropped", async () => {
    const world = workerR2World();

    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Mixed Submission" },
        files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
      }),
    );

    expect(started.uploads).toHaveLength(6);
    expect(world.data.jobs.size).toBe(1);
    expect(world.data.archives.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7–11 — the server boundary
// ---------------------------------------------------------------------------

describe("the server refuses the archive lane before any allocation", () => {
  /** An ordinary job that already exists, so plan/confirm can be reached. */
  async function jobWithOrdinaryFiles(world: FakeWorld) {
    return withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Ordinary Job" },
        files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
      }),
    );
  }

  it("(7, 9, 10, 11) planJobArchiveUpload refuses with nothing allocated", async () => {
    const world = workerR2World();
    const started = await jobWithOrdinaryFiles(world);
    await uploadAllViaTransport(world, started.uploads);
    const before = allocationCensus(world);
    world.workerR2.reset();

    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        planJobArchiveUpload(world.deps, OWNER, {
          jobId: started.jobId,
          fileName: "package.zip",
          declaredSize: 32 * 1024 * 1024,
          materialPurpose: "project_archive",
          partSha256: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)],
        }),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });

    const after = allocationCensus(world);
    // (9) no archive row, (10) no signed part target, (11) no object anywhere.
    expect(after.archives).toBe(0);
    expect(after.archiveEntries).toBe(0);
    expect(after.multipartUploads).toBe(0);
    expect(after.archiveR2Objects).toBe(0);
    expect(after.supabaseObjects).toBe(0);
    expect(after.supabaseSignedUploads).toBe(before.supabaseSignedUploads);
    expect(after.publicR2Objects).toBe(0);
    expect(after.projects).toBe(0);
    // (9) The audit trail records no archive event either.
    expect(after.audits).toBe(before.audits);
    // The refusal never even reached storage: no binding call, no S3 attempt.
    expect(world.workerR2.calls).toEqual([]);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    // The ordinary job and its six private objects are untouched.
    expect(after.jobs).toBe(1);
    expect(after.privateR2Objects).toBe(6);
  });

  it("(7) confirmJobArchiveUpload refuses on the same terms", async () => {
    const world = workerR2World();
    const started = await jobWithOrdinaryFiles(world);
    const before = allocationCensus(world);

    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        confirmJobArchiveUpload(world.deps, OWNER, {
          jobId: started.jobId,
          archiveId: "00000000-0000-4000-8000-000000000002",
          partSha256: ["a".repeat(64)],
        }),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });

    expect(allocationCensus(world)).toEqual(before);
  });

  it("(5) the refusal carries no filename, path, key, bucket, URL or credential", async () => {
    const world = workerR2World();
    const started = await jobWithOrdinaryFiles(world);

    const error = await withWorkerRuntime(world.workerR2.env, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        fileName: "coralina-private-package.zip",
        declaredSize: 32 * 1024 * 1024,
        materialPurpose: "project_archive",
        partSha256: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)],
      }),
    ).then(
      () => null,
      (thrown: Error) => thrown,
    );

    const surfaced = `${error?.name} ${error?.message}`;
    for (const forbidden of [
      "coralina-private-package.zip",
      started.jobId,
      OWNER.userId,
      TEST_R2_BUCKETS.privateSources,
      TEST_R2_BUCKETS.projectArchives,
      "studio/jobs",
      "archives/",
      "local-r2.invalid",
      "X-Amz",
      "LOCALTESTACCESSKEY",
    ]) {
      expect(surfaced, `refusal must not contain ${forbidden}`).not.toContain(forbidden);
    }
    expect(error?.name).toBe(ARCHIVE_UPLOAD_UNAVAILABLE_CODE);
  });

  it("(8) refuses BEFORE the job row when the submission declares an archive", async () => {
    const world = workerR2World();

    await expect(
      withWorkerRuntime(world.workerR2.env, () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          projectFacts: { name: "Archive Only" },
          files: [],
          archives: [{ name: "package.zip", size: 4096, materialPurpose: "project_archive" }],
        }),
      ),
    ).rejects.toMatchObject({ name: ARCHIVE_UPLOAD_UNAVAILABLE_CODE });

    expect(world.data.jobs.size).toBe(0);
    expect(world.data.archives.size).toBe(0);
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources)).toEqual([]);
  });

  it("the SERVER gate is lane-scoped: a small package.zip is still accepted", async () => {
    // The server refuses the resumable LANE, not the window: a ZIP small enough
    // for the ordinary signed lane never needs a part listing.
    //
    // The WINDOW is coarser — its picker is disabled outright — so this path is
    // not reachable from the Studio UI while the lane is closed. That gap is
    // deliberate and is recorded in
    // docs/FOREVER_R2_WORKER_BINDING_OBJECT_PLANE.md §3.3; this test pins the
    // server half so re-opening the window later needs no server change.
    const world = workerR2World();

    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Small Package" },
        files: [{ name: "package.zip", materialPurpose: "project_archive" }],
      }),
    );

    expect(started.uploads).toHaveLength(1);
    expect(world.data.jobs.size).toBe(1);
  });
});

describe("the capability the server reports", () => {
  it("is temporarily_unavailable on a Worker writing to R2", async () => {
    const world = workerR2World();
    const overview = await withWorkerRuntime(world.workerR2.env, () =>
      getOverview(world.deps, OWNER),
    );
    expect(overview.capabilities.archiveUpload).toBe("temporarily_unavailable");
  });

  it("(15, 16, 17) is available off a Worker, and on Supabase", async () => {
    const nodeWorld = nodeR2World();
    expect((await getOverview(nodeWorld.deps, OWNER)).capabilities.archiveUpload).toBe("available");

    const supabaseWorld = makeWorld();
    expect((await getOverview(supabaseWorld.deps, OWNER)).capabilities.archiveUpload).toBe(
      "available",
    );
  });

  it("fails closed when the storage plane cannot even be built", async () => {
    const world = nodeR2World();
    world.flags.r2Unavailable = true;

    const overview = await getOverview(world.deps, OWNER);

    // The dashboard still loads, and it does not offer a lane it cannot run.
    expect(overview.capabilities.archiveUpload).toBe("temporarily_unavailable");
    expect(overview.session.role).toBe("owner");
  });

  it("exposes nothing but the closed enum", async () => {
    const world = workerR2World();
    const overview = await withWorkerRuntime(world.workerR2.env, () =>
      getOverview(world.deps, OWNER),
    );

    expect(Object.keys(overview.capabilities)).toEqual(["archiveUpload"]);
    const serialized = JSON.stringify(overview.capabilities);
    for (const forbidden of ["r2", "worker", "binding", "bucket", "supabase", "R2_"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// 14, 18, 19 — the ordinary path is completely unaffected
// ---------------------------------------------------------------------------

/**
 * Settle a call WITHOUT letting a rejection abort the test.
 *
 * "It threw" and "it was refused for the right reason" are different outcomes,
 * and so are "it threw" and "it must never throw at all". Awaiting directly
 * collapses them into one red test that does not say which invariant broke.
 */
async function settleCall<T>(promise: Promise<T>): Promise<{ threw: boolean; value?: T }> {
  try {
    return { threw: false, value: await promise };
  } catch {
    return { threw: true };
  }
}

describe("the ordinary Coralina-equivalent path is untouched by the gate", () => {
  it("(8, 14) a submission with NO archive is never touched by the gate", async () => {
    const world = workerR2World();

    const settled = await settleCall(
      withWorkerRuntime(world.workerR2.env, () =>
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          projectFacts: { name: "Ordinary Only" },
          files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
        }),
      ),
    );

    expect(
      settled.threw,
      "the archive gate must never refuse a submission that declares no archive",
    ).toBe(false);
    expect(settled.value!.uploads).toHaveLength(6);
    expect(world.data.jobs.size).toBe(1);
  });

  it("(14, 18) publishes the six-file manifest without re-upload, on bindings", async () => {
    const world = workerR2World();
    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Sanitized Pilot Equivalent" },
        files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
      }),
    );
    await uploadAllViaTransport(world, started.uploads);
    const objectsBefore = world.r2.keys(TEST_R2_BUCKETS.privateSources).slice().sort();
    expect(objectsBefore).toHaveLength(6);
    world.workerR2.reset();

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );

    expect(result.status).toBe("published");
    // (18) No Supabase Storage object, ever.
    expect(world.storage.objects.size).toBe(0);
    // No re-upload: the private bucket membership is unchanged.
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources).slice().sort()).toEqual(objectsBefore);
    // (17) No Worker-side S3 processing fallback.
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    // Exactly one project; derivatives only in public media.
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia).length).toBeGreaterThanOrEqual(3);
    expect(world.data.archives.size).toBe(0);
  });

  it("(19) a failed ordinary attempt still records stage telemetry and the retry budget", async () => {
    const world = workerR2World();
    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Telemetry Preserved" },
        files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
      }),
    );
    await uploadAllViaTransport(world, started.uploads);
    const restore = world.workerR2.failBinding("private_source", "head");

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    restore();

    expect(result.errorCode).toBe("object_stat_failed");
    const job = world.data.jobs.get(started.jobId)!;
    const facts = job.facts as Record<string, unknown>;
    expect((facts.processing as { stage?: string })?.stage).toBe("object_stat");
    expect(facts.retry).toBeTruthy();
  });

  it("(15, 16) the full archive lane still works off a Worker, end to end", async () => {
    const world = nodeR2World();
    const provider = world.deps.storageProviders.get("r2");

    expect(provider.archiveControlPlane).toBe("available");
    const geometry = {
      jobId: "00000000-0000-4000-8000-000000000001",
      archiveId: "00000000-0000-4000-8000-000000000002",
      declaredSize: 16,
      partSize: 8,
      partCount: 2,
    };
    const state = await provider.beginArchiveUpload(geometry);
    expect(state.multipartUploadId).toBeTruthy();
    await expect(
      provider.archivePartTargets({ geometry, state, indexes: [0, 1] }),
    ).resolves.toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 20 — the bundle boundary
// ---------------------------------------------------------------------------

describe("the capability carries no server internals into the browser", () => {
  it("(20) the client-safe module holds only the enum, the code and the copy", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/features/forever-studio/archive-capability.ts", "utf8");

    // No server-only import can follow this module into the bundle.
    expect(source).not.toMatch(/^import .*\.server/m);
    expect(source).not.toMatch(/^import .*\/server\//m);
    for (const forbidden of [
      "R2_PRIVATE_SOURCES",
      "R2_PUBLIC_MEDIA",
      "R2_PROJECT_ARCHIVES",
      "__env__",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCESS_KEY_ID",
      "AWS4-HMAC-SHA256",
      "cloudflarestorage",
      "forever-private-sources",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
