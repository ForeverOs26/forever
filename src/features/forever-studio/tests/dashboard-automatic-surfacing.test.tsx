/**
 * FOREVER-PR134-AUTOMATIC-RETRY-SURFACING-FIX-001 — what the DASHBOARD does
 * when the only failed jobs are ones nothing will ever retry.
 *
 * Three behaviours hang off one number, `activeJobs`: the five-second poll, the
 * automatic-resume call, and the banner that says processing "continues
 * automatically even if you close the page". The server-side fix makes that
 * number exclude automatically exhausted jobs — but a number being right is
 * only half of it, and these tests are the half that renders the component and
 * watches the clock.
 *
 * They also pin the other direction, which matters just as much: the failure
 * does not disappear. It keeps its safe error code, its true attempt count, and
 * a Retry control, because a job the background has given up on is precisely
 * the one a person needs to be able to find.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getOverview: vi.fn(),
  resumePending: vi.fn(),
  processJob: vi.fn(),
  getJobStatus: vi.fn(),
  setProjectPublication: vi.fn(),
  setListingPublication: vi.fn(),
}));

vi.mock("../studio.functions", () => ({
  studioGetOverview: endpoints.getOverview,
  studioResumePending: endpoints.resumePending,
  studioProcessJob: endpoints.processJob,
  studioGetJobStatus: endpoints.getJobStatus,
  studioSetProjectPublication: endpoints.setProjectPublication,
  studioSetListingPublication: endpoints.setListingPublication,
}));

vi.mock("../components/useStudioSession", () => ({
  useStudioSession: () => ({
    status: "signed_in",
    userId: "user-owner",
    email: "owner@example.com",
  }),
}));

import { StudioDashboard } from "../components/StudioDashboard";
import { STUDIO_AUTOMATIC_RETRY_LIMIT } from "../server/retry-policy";

const CAPPED_JOB = {
  id: "job-capped",
  workflow: "new_development" as const,
  status: "failed" as const,
  projectSlug: "capped-project",
  listingId: null,
  creatorEmail: "owner@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  errorCode: "object_stat_failed",
  errorStage: "object_stat",
  error: "Forever could not confirm the uploaded files in storage.",
  retryable: true,
  automaticRetry: "exhausted" as const,
  attemptCount: STUDIO_AUTOMATIC_RETRY_LIMIT,
};

const TERMINAL_JOB = {
  ...CAPPED_JOB,
  id: "job-terminal",
  projectSlug: "terminal-project",
  errorCode: "provider_resolution_failed",
  retryable: false,
};

function overview(input: { activeJobs: number; jobs: unknown[] }) {
  return {
    session: {
      userId: "user-owner",
      email: "owner@example.com",
      role: "owner" as const,
      displayName: "Owner",
    },
    capabilities: { archiveUpload: "available" as const },
    projects: [],
    listings: [],
    jobs: input.jobs,
    members: [],
    activeJobs: input.activeJobs,
  };
}

function renderDashboard() {
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
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio",
    component: () => <StudioDashboard />,
  });
  const uploadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/upload",
    component: () => <p>Upload</p>,
  });
  const membersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/members",
    component: () => <p>Members</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([studioRoute, uploadRoute, membersRoute]),
    history: createMemoryHistory({ initialEntries: ["/studio"] }),
  });
  return render(<RouterProvider router={router} />);
}

/**
 * Let the overview query resolve under fake timers.
 *
 * A couple of microtasks is not enough: react-query settles across several,
 * and the timers are faked, so the flush has to be explicit or the assertions
 * race the loading state.
 */
async function settle() {
  await act(async () => {
    for (let flush = 0; flush < 10; flush += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
    for (let flush = 0; flush < 10; flush += 1) await Promise.resolve();
  });
}

/**
 * The banner sentence is interpolated, so it is split across text nodes and no
 * single element holds it. Matching the rendered page's whole text is both
 * simpler and closer to what the Owner actually reads.
 */
const BANNER = /this continues\s*automatically even if you close the page/i;
const pageText = () => document.body.textContent ?? "";

describe("the dashboard when only exhausted jobs remain", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset().mockResolvedValue({
      jobId: "job-capped",
      status: "completed",
      workflow: "new_development",
      attemptCount: STUDIO_AUTOMATIC_RETRY_LIMIT + 1,
      pagePath: "/projects/capped-project",
      projectSlug: "capped-project",
      listingId: null,
      publicStatus: "published",
      counts: null,
      warnings: [],
      errorCode: null,
      errorStage: null,
      error: null,
      retryable: false,
    });
    endpoints.getJobStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(5) shows no automatic-processing banner", async () => {
    endpoints.getOverview.mockResolvedValue(overview({ activeJobs: 0, jobs: [CAPPED_JOB] }));

    renderDashboard();
    await settle();

    expect(pageText()).not.toMatch(BANNER);
    // The job itself is still on the page — nothing was hidden.
    expect(pageText()).toContain("capped-project");
  });

  it("(6) stops polling, and never calls automatic resume", async () => {
    endpoints.getOverview.mockResolvedValue(overview({ activeJobs: 0, jobs: [CAPPED_JOB] }));

    renderDashboard();
    await settle();
    const afterFirstRender = endpoints.getOverview.mock.calls.length;

    // Three poll intervals. A dashboard that still believed there was automatic
    // work would have refetched every five seconds and asked the server to
    // resume each time.
    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
    }

    expect(endpoints.getOverview.mock.calls.length).toBe(afterFirstRender);
    expect(endpoints.resumePending).not.toHaveBeenCalled();
  });

  it("(7) keeps the failure, its safe code and its true attempt count visible", async () => {
    endpoints.getOverview.mockResolvedValue(
      overview({ activeJobs: 0, jobs: [CAPPED_JOB, TERMINAL_JOB] }),
    );

    renderDashboard();
    await settle();

    const capped = screen.getByTestId("studio-job-failure-job-capped");
    expect(capped.textContent).toContain("object_stat_failed");
    expect(capped.textContent).toContain(`attempt ${STUDIO_AUTOMATIC_RETRY_LIMIT}`);
    // It says plainly that nothing is coming to rescue it.
    expect(capped.textContent).toMatch(/automatic retries stopped/i);
    // And it never claims background progress.
    expect(capped.textContent).not.toMatch(/continues automatically/i);

    const terminal = screen.getByTestId("studio-job-failure-job-terminal");
    expect(terminal.textContent).toContain("provider_resolution_failed");
  });

  it("(8, 9) offers Retry for the exhausted job and not for the terminal one", async () => {
    endpoints.getOverview.mockResolvedValue(
      overview({ activeJobs: 0, jobs: [CAPPED_JOB, TERMINAL_JOB] }),
    );

    renderDashboard();
    await settle();

    // Exactly one Retry control: the exhausted job the database would still
    // admit. The terminal one offers none, because a claim would be refused.
    const retries = screen.getAllByRole("button", { name: "Retry processing" });
    expect(retries).toHaveLength(1);

    await act(async () => {
      fireEvent.click(retries[0]);
    });
    await settle();

    // (9) It reaches the ordinary controlled-processing endpoint — the same one
    // the uploader uses, with the same payload. No SQL, no special path. The
    // action also carries its own cancellation handle for the absolute
    // deadline, which is local to the browser and changes nothing server-side.
    expect(endpoints.processJob).toHaveBeenCalledWith(
      expect.objectContaining({ data: { jobId: "job-capped" } }),
    );
  });
});

describe("the dashboard when genuine automatic work exists", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(5) still shows the banner and (6) still polls and resumes", async () => {
    endpoints.getOverview.mockResolvedValue(
      overview({ activeJobs: 1, jobs: [{ ...CAPPED_JOB, id: "job-live", status: "processing" }] }),
    );

    renderDashboard();
    await settle();

    expect(pageText()).toMatch(BANNER);
    expect(endpoints.resumePending).toHaveBeenCalled();
    const afterFirstRender = endpoints.getOverview.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(endpoints.getOverview.mock.calls.length).toBeGreaterThan(afterFirstRender);
  });
});
