/**
 * FOREVER-STUDIO-UNPUBLISHED-INGESTION-001 — what the upload screen SAYS.
 *
 * The server no longer publishes a project on upload. A screen that still
 * promised publication would be the same class of defect `publication-outcome`
 * exists to remove: a constant claim of liveness that the run did not earn.
 * These tests pin the copy in both directions —
 *
 *   - a PROJECT upload offers to save a draft, says so before and after, and
 *     offers no public page link and no Share action (both would be dead: a
 *     draft has no public route);
 *   - a RESALE upload is a different lane that still publishes on upload, and
 *     keeps its live wording, its page link and its Share action.
 *
 * The durable product rule is asserted alongside: no window is required, and
 * nothing here introduces an approval, readiness or verification gate.
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

vi.mock("../studio.functions", () => ({
  studioGetOverview: endpoints.getOverview,
  studioStartJob: endpoints.startJob,
  studioProcessJob: endpoints.processJob,
  studioPlanArchiveUpload: vi.fn(),
  studioConfirmArchiveUpload: vi.fn(),
  studioResumePending: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } },
}));

import { StudioUploader } from "../components/StudioUploader";
import type { StudioWorkflow } from "../studio-types";
import { withProductionUploadOrigin } from "./upload-origin-fixture";

// The uploader renders an upload interface only on the declared production
// origin (Issue #103), so this suite runs on it.
withProductionUploadOrigin();

const OVERVIEW = {
  session: { role: "owner", email: "owner@example.com", displayName: "Owner" },
  capabilities: { archiveUpload: "available" as const },
  projects: [],
  listings: [],
  jobs: [],
  members: [],
  activeJobs: 0,
};

function renderUploader(workflow: StudioWorkflow) {
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
    component: () => <StudioUploader workflow={workflow} />,
  });
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio",
    component: () => <p>Studio dashboard</p>,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/project/$slug",
    component: () => <p>Project editor</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([studioRoute, projectRoute, uploadRoute]),
    history: createMemoryHistory({ initialEntries: ["/studio/upload"] }),
  });
  return render(<RouterProvider router={router} />);
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("studio-upload-submit"));
  });
}

/** What the server returns for a project ingestion now: a DRAFT. */
const DRAFT_RESULT = {
  status: "published",
  pagePath: "/projects/x",
  publicStatus: "draft",
  warnings: [],
  counts: { buildings: 0, units: 3, prices: 3, media: 1, warnings: 0 },
  projectSlug: "x",
  listingId: null,
};

/** What the resale lane returns: it really did publish. */
const PUBLISHED_LISTING_RESULT = {
  status: "published",
  pagePath: "/resale/y",
  publicStatus: "published",
  warnings: [],
  counts: { buildings: 0, units: 0, prices: 0, media: 1, warnings: 0 },
  projectSlug: null,
  listingId: "listing-1",
};

describe("the upload screen describes a draft, not a publication", () => {
  beforeAll(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(OVERVIEW);
    endpoints.startJob.mockReset().mockResolvedValue({ jobId: "job-1", uploads: [] });
    endpoints.processJob.mockReset().mockResolvedValue(DRAFT_RESULT);
  });

  it("labels the project submit control 'Save as draft', never 'Publish now'", async () => {
    renderUploader("new_development");
    const button = await screen.findByTestId("studio-upload-submit");
    expect(button).toHaveTextContent("Save as draft");
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
  });

  it("promises a draft for review, and never immediate publication", async () => {
    renderUploader("new_development");
    await screen.findByTestId("studio-upload-submit");

    expect(
      screen.getByText(/saved as an unpublished draft for review/i, { exact: false }),
    ).toBeVisible();
    expect(screen.getByText(/does not go on the public site/i, { exact: false })).toBeVisible();
    // The exact sentence the screen used to carry, in any casing.
    expect(screen.queryByText(/publishes immediately/i)).toBeNull();
  });

  it("keeps the durable product rule: missing information still blocks nothing", async () => {
    renderUploader("new_development");
    await screen.findByTestId("studio-upload-submit");

    expect(screen.getByText(/never blocks it/i, { exact: false })).toBeVisible();
    // And no gate wording appeared alongside the draft language.
    const buttons = screen.getAllByRole("button").map((node) => node.textContent ?? "");
    for (const forbidden of [/approve/i, /readiness/i, /verify/i, /submit for/i]) {
      expect(
        buttons.filter((text) => forbidden.test(text)),
        String(forbidden),
      ).toHaveLength(0);
    }
  });

  it("reports the finished run as a saved draft that is not on the public site", async () => {
    renderUploader("new_development");
    await screen.findByTestId("studio-upload-submit");
    await submit();

    expect(await screen.findByRole("heading", { name: "Draft saved" })).toBeVisible();
    expect(screen.getByText(/it is not on the public site/i, { exact: false })).toBeVisible();
    expect(screen.queryByText(/The page is live now/i)).toBeNull();
  });

  it("offers a review link, and NEITHER a public page link nor Share", async () => {
    // A draft has no public route. "Open page" would 404 and "Share" would hand
    // the Owner a dead URL to send to a client — the exact false claim of
    // liveness this change removes.
    renderUploader("new_development");
    await screen.findByTestId("studio-upload-submit");
    await submit();
    await screen.findByRole("heading", { name: "Draft saved" });

    expect(screen.getByRole("link", { name: "Review draft" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});

describe("the resale lane still publishes, and still says so", () => {
  beforeAll(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(OVERVIEW);
    endpoints.startJob.mockReset().mockResolvedValue({ jobId: "job-2", uploads: [] });
    endpoints.processJob.mockReset().mockResolvedValue(PUBLISHED_LISTING_RESULT);
  });

  it("keeps 'Publish now' and the immediate-publication caption", async () => {
    renderUploader("resale_listing");
    const button = await screen.findByTestId("studio-upload-submit");
    expect(button).toHaveTextContent("Publish now");
    expect(screen.getByText(/listing publishes immediately/i, { exact: false })).toBeVisible();
    expect(screen.queryByText(/saved as an unpublished draft/i)).toBeNull();
  });

  it("keeps the live heading, the page link and Share for a published listing", async () => {
    renderUploader("resale_listing");
    await screen.findByTestId("studio-upload-submit");
    await submit();

    expect(await screen.findByRole("heading", { name: "Published" })).toBeVisible();
    expect(screen.getByText(/The page is live now/i, { exact: false })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open page" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Share" })).toBeVisible();
  });
});
