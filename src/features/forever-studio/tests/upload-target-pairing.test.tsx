/**
 * FOREVER-PR130-MATERIAL-SLOTS-CORRECTION-001 — F3: which bytes reach which
 * signed target.
 *
 * The whole explicit-purpose contract rests on one unwritten assumption: the
 * File the Owner put in a window is the File whose bytes arrive at that file's
 * staging path. Before this correction NOTHING tested it — every uploader test
 * resolved `uploads: []`, so the pairing loop never ran, and a deliberate
 * reversal of the pairing passed all 45 tests. A future reorder would have
 * published file A's bytes under file B's Owner-selected purpose.
 *
 * The pairing is now keyed on a server-assigned `fileIndex` rather than array
 * position or filename, and these tests exercise it with a NON-EMPTY uploads
 * array: every case asserts the exact File object that reached each target.
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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getOverview: vi.fn(),
  startJob: vi.fn(),
  processJob: vi.fn(),
}));

const uploaded = vi.hoisted(() => ({ toSignedUrl: vi.fn(), bucketOf: vi.fn() }));
const archive = vi.hoisted(() => ({ uploadLargeArchive: vi.fn() }));

vi.mock("../studio.functions", () => ({
  studioGetOverview: endpoints.getOverview,
  studioStartJob: endpoints.startJob,
  studioProcessJob: endpoints.processJob,
  studioPlanArchiveUpload: vi.fn(),
  studioConfirmArchiveUpload: vi.fn(),
  studioResumePending: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        uploaded.bucketOf(bucket);
        return { uploadToSignedUrl: uploaded.toSignedUrl };
      },
    },
  },
}));

vi.mock("../components/archive-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/archive-upload")>();
  return {
    ...actual,
    // Tiny fixtures must still take the large-archive lane.
    isLargeArchive: (file: File) => file.name.endsWith(".zip"),
    archiveTooLarge: () => false,
    uploadLargeArchive: archive.uploadLargeArchive,
  };
});

import { StudioUploader } from "../components/StudioUploader";
import type { StartJobInput, StudioUploadTarget } from "../studio-types";

const OVERVIEW = {
  session: { role: "owner", email: "owner@example.com", displayName: "Owner" },
  // The resumable lane is open here: pairing is what these tests are about.
  capabilities: { archiveUpload: "available" as const },
  projects: [],
  listings: [],
  jobs: [],
  members: [],
  activeJobs: 0,
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

async function addTo(label: string, ...files: File[]) {
  const input = screen.getByLabelText(label, { selector: 'input[type="file"]' });
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

async function publish() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
  });
}

/**
 * Every fixture File is registered against a unique marker, so an assertion can
 * name the EXACT File object that reached a target. Object identity is the
 * strongest available proof here: two files may share a name, and the same File
 * may legitimately appear under two windows.
 */
const markers = new WeakMap<File, string>();

function file(name: string, marker: string): File {
  const created = new File([new TextEncoder().encode(marker)], name);
  markers.set(created, marker);
  return created;
}

function markerOf(body: unknown): string {
  return markers.get(body as File) ?? "<unregistered File>";
}

/**
 * The server's own pairing rule, modelled exactly: one signed target per
 * declared file, carrying that file's index in the request manifest, and a
 * staging path that embeds the same index. `transform` reorders or corrupts the
 * response the way a future server change (or a hostile one) might.
 */
function serverTargets(
  input: StartJobInput,
  transform: (targets: StudioUploadTarget[]) => StudioUploadTarget[] = (targets) => targets,
) {
  const targets = input.files.map((declared, fileIndex) => ({
    name: declared.name,
    fileIndex,
    bucket: "studio-uploads",
    path: `jobs/job-1/staging/${String(fileIndex).padStart(2, "0")}-${declared.name}`,
    token: `signed-${fileIndex}`,
  }));
  return { jobId: "job-1", uploads: transform(targets) };
}

function mockStartJob(transform?: (targets: StudioUploadTarget[]) => StudioUploadTarget[]): void {
  endpoints.startJob.mockImplementation(async ({ data }: { data: StartJobInput }) =>
    serverTargets(data, transform),
  );
}

/** Every delivery in the order it was actually attempted. */
function deliveries(): Array<{ path: string; token: string; name: string }> {
  return uploaded.toSignedUrl.mock.calls.map(([path, token, body]) => ({
    path: path as string,
    token: token as string,
    name: (body as File).name,
  }));
}

/** Which EXACT File object reached each signed path. */
function deliveredFiles(): Record<string, string> {
  return Object.fromEntries(
    uploaded.toSignedUrl.mock.calls.map(([path, , body]) => [path as string, markerOf(body)]),
  );
}

describe("upload target pairing", () => {
  beforeAll(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(OVERVIEW);
    endpoints.startJob.mockReset();
    endpoints.processJob.mockReset().mockResolvedValue({
      status: "published",
      pagePath: "/projects/x",
      warnings: [],
      counts: null,
      projectSlug: "x",
      listingId: null,
    });
    uploaded.toSignedUrl.mockReset().mockResolvedValue({ error: null });
    uploaded.bucketOf.mockReset();
    archive.uploadLargeArchive.mockReset().mockResolvedValue({ archiveId: "arch-1" });
    mockStartJob();
  });

  // 1 -------------------------------------------------------------------------
  it("sends two files in different windows to their own targets", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("q3.pdf", "PRICE-BYTES"));
    await addTo("Documents / Legal", file("deed.pdf", "DEED-BYTES"));
    await publish();

    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-q3.pdf": "PRICE-BYTES",
      "jobs/job-1/staging/01-deed.pdf": "DEED-BYTES",
    });
  });

  // 2 -------------------------------------------------------------------------
  it("keeps two IDENTICALLY NAMED files in different windows apart", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("scan.pdf", "IN-PRICE-LIST"));
    await addTo("Documents / Legal", file("scan.pdf", "IN-DOCUMENTS"));
    await publish();

    // Same filename twice: pairing by name would be ambiguous, pairing by
    // identity is not.
    const sent = endpoints.startJob.mock.calls[0][0].data as StartJobInput;
    expect(sent.files.map((entry) => entry.materialPurpose)).toEqual([
      "price_list",
      "document_legal",
    ]);
    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-scan.pdf": "IN-PRICE-LIST",
      "jobs/job-1/staging/01-scan.pdf": "IN-DOCUMENTS",
    });
  });

  // 3 -------------------------------------------------------------------------
  it("keeps the SAME File object selected under two windows independent", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    const shared = file("shared.jpg", "SHARED-BYTES");
    await addTo("Project Photos / Renders", shared);
    await addTo("Construction Photos", shared);
    await publish();

    const sent = endpoints.startJob.mock.calls[0][0].data as StartJobInput;
    expect(sent.files.map((entry) => entry.materialPurpose)).toEqual([
      "project_photo",
      "construction_photo",
    ]);
    // Two targets, two uploads of the same bytes — never one target reused.
    const calls = deliveries();
    expect(calls.map((call) => call.path)).toEqual([
      "jobs/job-1/staging/00-shared.jpg",
      "jobs/job-1/staging/01-shared.jpg",
    ]);
    expect(uploaded.toSignedUrl.mock.calls.every(([, , body]) => body === shared)).toBe(true);
  });

  // 4 -------------------------------------------------------------------------
  it("is unaffected when the server returns its targets in REVERSED order", async () => {
    mockStartJob((targets) => [...targets].reverse());
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("q3.pdf", "PRICE-BYTES"));
    await addTo("Documents / Legal", file("deed.pdf", "DEED-BYTES"));
    await addTo("Floor Plans", file("level-2.pdf", "PLAN-BYTES"));
    await publish();

    // Identical mapping to the in-order case: order carries no meaning.
    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-q3.pdf": "PRICE-BYTES",
      "jobs/job-1/staging/01-deed.pdf": "DEED-BYTES",
      "jobs/job-1/staging/02-level-2.pdf": "PLAN-BYTES",
    });
    // ...and the reversal really did happen, so this is not vacuous.
    expect(deliveries().map((call) => call.path)).toEqual([
      "jobs/job-1/staging/02-level-2.pdf",
      "jobs/job-1/staging/01-deed.pdf",
      "jobs/job-1/staging/00-q3.pdf",
    ]);
  });

  // 5 -------------------------------------------------------------------------
  it("survives a file being removed and re-added before submission", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("q3.pdf", "OLD-PRICE"));
    await addTo("Documents / Legal", file("deed.pdf", "DEED-BYTES"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove q3.pdf from Price List" }));
    });
    await addTo("Price List", file("q3.pdf", "NEW-PRICE"));
    await publish();

    // The re-added file is now LAST in the manifest; the removed one is gone.
    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-deed.pdf": "DEED-BYTES",
      "jobs/job-1/staging/01-q3.pdf": "NEW-PRICE",
    });
  });

  // 6 -------------------------------------------------------------------------
  it("pairs correctly with ONE large archive interleaved among ordinary files", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("q3.pdf", "PRICE-BYTES"));
    await addTo("Full Project Archive / Other Package", file("package.zip", "ZIP-BYTES"));
    await addTo("Documents / Legal", file("deed.pdf", "DEED-BYTES"));
    await publish();

    // The archive left the ordinary manifest entirely, so the ordinary indexes
    // must close up around it rather than leaving a hole.
    const sent = endpoints.startJob.mock.calls[0][0].data as StartJobInput;
    expect(sent.files.map((entry) => entry.name)).toEqual(["q3.pdf", "deed.pdf"]);
    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-q3.pdf": "PRICE-BYTES",
      "jobs/job-1/staging/01-deed.pdf": "DEED-BYTES",
    });
    // ...and the archive took its own lane, carrying its own Owner window.
    expect(archive.uploadLargeArchive).toHaveBeenCalledTimes(1);
    expect(archive.uploadLargeArchive.mock.calls[0][1].name).toBe("package.zip");
    expect(archive.uploadLargeArchive.mock.calls[0][2]).toBe("project_archive");
  });

  // 7 -------------------------------------------------------------------------
  it("pairs correctly with MULTIPLE large archives in different windows", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Project Photos / Renders", file("photos.zip", "PHOTOS-ZIP"));
    await addTo("Price List", file("q3.pdf", "PRICE-BYTES"));
    await addTo("Documents / Legal", file("legal.zip", "LEGAL-ZIP"));
    await addTo("Construction Photos", file("site.jpg", "SITE-BYTES"));
    await publish();

    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-q3.pdf": "PRICE-BYTES",
      "jobs/job-1/staging/01-site.jpg": "SITE-BYTES",
    });
    // Each archive kept the window it was filed under — not the archive window,
    // and not each other's.
    expect(archive.uploadLargeArchive.mock.calls.map((call) => [call[1].name, call[2]])).toEqual([
      ["photos.zip", "project_photo"],
      ["legal.zip", "document_legal"],
    ]);
  });

  // 8 -------------------------------------------------------------------------
  it("reports the failed target only, and still delivers the others correctly", async () => {
    uploaded.toSignedUrl.mockImplementation(async (path: string) =>
      path.endsWith("01-deed.pdf") ? { error: new Error("HTTP 500") } : { error: null },
    );
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("q3.pdf", "PRICE-BYTES"));
    await addTo("Documents / Legal", file("deed.pdf", "DEED-BYTES"));
    await addTo("Floor Plans", file("level-2.pdf", "PLAN-BYTES"));
    await publish();

    expect(await screen.findByRole("heading", { name: "Published" })).toBeVisible();
    // Named the file that actually failed — not a neighbour.
    expect(screen.getByText(/failed to upload and were skipped/)).toHaveTextContent("deed.pdf");
    expect(deliveredFiles()).toEqual({
      "jobs/job-1/staging/00-q3.pdf": "PRICE-BYTES",
      "jobs/job-1/staging/01-deed.pdf": "DEED-BYTES",
      "jobs/job-1/staging/02-level-2.pdf": "PLAN-BYTES",
    });
  });

  // Refusals ------------------------------------------------------------------

  /**
   * A response whose identities are not a clean one-to-one mapping must abort
   * with NOTHING uploaded — uploading "the ones that look fine" would still be
   * guessing about the rest.
   */
  const BROKEN_IDENTITIES: Array<
    [string, (targets: StudioUploadTarget[]) => StudioUploadTarget[]]
  > = [
    [
      "missing",
      (targets) =>
        targets.map((target, index) =>
          index === 1 ? ({ ...target, fileIndex: undefined } as never) : target,
        ),
    ],
    ["duplicated", (targets) => targets.map((target) => ({ ...target, fileIndex: 0 }))],
    [
      "out of range",
      (targets) => targets.map((target) => ({ ...target, fileIndex: target.fileIndex + 5 })),
    ],
    ["negative", (targets) => targets.map((target) => ({ ...target, fileIndex: -1 }))],
    ["non-integer", (targets) => targets.map((target) => ({ ...target, fileIndex: 0.5 }))],
  ];

  for (const [label, transform] of BROKEN_IDENTITIES) {
    it(`refuses to upload anything when a target identity is ${label}`, async () => {
      mockStartJob(transform);
      const view = renderUploader();
      await screen.findByRole("button", { name: "Publish now" });
      await addTo("Price List", file("q3.pdf", "PRICE-BYTES"));
      await addTo("Documents / Legal", file("deed.pdf", "DEED-BYTES"));
      await publish();

      // Nothing reached storage, and the Owner is told plainly.
      expect(uploaded.toSignedUrl).not.toHaveBeenCalled();
      expect(
        await screen.findByText(/could not match an upload slot to the file you chose/, undefined, {
          timeout: 10000,
        }),
      ).toBeVisible();
      // The refusal never leaks a private staging path or a signed token.
      const shown = view.container.textContent ?? "";
      expect(shown).not.toContain("studio-uploads");
      expect(shown).not.toContain("signed-");
      expect(shown).not.toContain("jobs/job-1");
    });
  }

  it("uploads every file to the PRIVATE staging bucket and nowhere else", async () => {
    renderUploader();
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Project Photos / Renders", file("a.jpg", "A"));
    await addTo("Brochure", file("b.pdf", "B"));
    await publish();
    expect(new Set(uploaded.bucketOf.mock.calls.flat())).toEqual(new Set(["studio-uploads"]));
  });
});
