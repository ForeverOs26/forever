/**
 * FOREVER-STUDIO-LARGE-ARCHIVE-001 — Android staging incident regression
 * tests, uploader recovery surface.
 *
 *  - an upload-stage failure offers "Resume upload" (replan + missing parts
 *    only) and NEVER requests processing against an incomplete archive;
 *  - the resumed attempt reuses the SAME job (no duplicate job/archive);
 *  - a transient overview failure renders the retryable "unreachable" panel
 *    and recovers, while a server-proven denial still settles as denied.
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
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getOverview: vi.fn(),
  startJob: vi.fn(),
  processJob: vi.fn(),
}));

const uploader = vi.hoisted(() => ({
  uploadLargeArchive: vi.fn(),
}));

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
    storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) },
  },
}));

vi.mock("../components/archive-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/archive-upload")>();
  return {
    ...actual,
    // Small fixture files must still take the large-archive lane.
    isLargeArchive: (file: File) => file.name.endsWith(".zip"),
    archiveTooLarge: () => false,
    uploadLargeArchive: uploader.uploadLargeArchive,
  };
});

import { StudioUploader } from "../components/StudioUploader";

const OVERVIEW = {
  session: { role: "owner", email: "owner@example.com", displayName: "Owner" },
  projects: [],
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
    component: () => <StudioUploader />,
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
  const view = render(<RouterProvider router={router} />);
  return { queryClient, view };
}

async function submitZip() {
  const { view } = renderUploader();
  const publish = await screen.findByRole("button", { name: "Publish now" });
  const input = view.container.querySelector('input[type="file"][multiple]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input not rendered");
  const zip = new File([new Uint8Array(16)], "big.zip");
  await act(async () => {
    fireEvent.change(input, { target: { files: [zip] } });
  });
  await act(async () => {
    fireEvent.click(publish);
  });
}

describe("StudioUploader incident recovery", () => {
  beforeAll(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(OVERVIEW);
    endpoints.startJob.mockReset();
    endpoints.processJob.mockReset();
    uploader.uploadLargeArchive.mockReset();
  });

  it("offers Resume upload after an upload-stage failure and never requests processing early", async () => {
    endpoints.startJob.mockResolvedValue({ jobId: "job-9", uploads: [] });
    uploader.uploadLargeArchive
      .mockRejectedValueOnce(
        Object.assign(new Error("Part 11 failed to upload after 4 attempts: Failed to fetch"), {
          name: "archive_part_upload_failed",
        }),
      )
      .mockResolvedValueOnce({ archiveId: "arch-9" });
    endpoints.processJob.mockResolvedValue({
      status: "published",
      pagePath: null,
      warnings: [],
      counts: null,
      projectSlug: null,
      listingId: null,
    });

    await submitZip();

    // Upload-stage failure: the recovery affordance is an upload resume, and
    // processing has NOT been requested against the incomplete archive.
    const resume = await screen.findByRole("button", { name: "Resume upload" });
    expect(screen.queryByRole("button", { name: "Retry processing" })).not.toBeInTheDocument();
    expect(endpoints.processJob).not.toHaveBeenCalled();
    expect(uploader.uploadLargeArchive).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(resume);
    });

    await screen.findByRole("heading", { name: "Published" });
    // The SAME job resumed — no duplicate job — and processing ran only after
    // the archive upload completed.
    expect(endpoints.startJob).toHaveBeenCalledTimes(1);
    expect(uploader.uploadLargeArchive).toHaveBeenCalledTimes(2);
    expect(uploader.uploadLargeArchive.mock.calls[0][0]).toBe("job-9");
    expect(uploader.uploadLargeArchive.mock.calls[1][0]).toBe("job-9");
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
  });

  it("renders a retryable unreachable panel (not access denied) for a transient overview failure, and recovers", async () => {
    endpoints.getOverview
      .mockReset()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(OVERVIEW);

    renderUploader();
    expect(
      await screen.findByRole("heading", { name: "Studio is unreachable right now" }),
    ).toBeVisible();
    expect(screen.queryByText("Studio access denied")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(await screen.findByRole("button", { name: "Publish now" })).toBeVisible();
  });

  it("still settles a server-proven denial as access denied", async () => {
    const denial = new Error("This account is not a Forever Studio member.");
    denial.name = "studio_membership_required";
    endpoints.getOverview.mockReset().mockRejectedValue(denial);

    renderUploader();
    expect(await screen.findByRole("heading", { name: "Studio access denied" })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText("Studio is unreachable right now")).not.toBeInTheDocument(),
    );
  });
});
