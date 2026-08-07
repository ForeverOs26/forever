/**
 * FOREVER-PR134-MANUAL-RETRY-PROGRESS-AND-RECOVERY-RUNBOOK-001
 *
 * One Owner action gets one mutation and a bounded, read-only observer for
 * exactly that job. These tests render the dashboard and drive the real timer
 * state machine; they never substitute the global activeJobs loop for it.
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
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioJobListItem, StudioJobResult, StudioOverview } from "../studio-types";

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

import { StudioDashboard, STUDIO_OVERVIEW_KEY } from "../components/StudioDashboard";
import { STUDIO_OWNER_RETRY_OBSERVATION } from "../components/manual-retry-observation";

const JOB_A: StudioJobListItem = {
  id: "job-a",
  workflow: "new_development",
  status: "failed",
  projectSlug: "project-a",
  listingId: null,
  creatorEmail: "owner@example.com",
  createdAt: "2026-08-03T00:00:00.000Z",
  errorCode: "object_stat_failed",
  errorStage: "object_stat",
  error: "Forever could not confirm the uploaded files in storage.",
  retryable: true,
  automaticRetry: "exhausted",
  attemptCount: 7,
};

const JOB_B: StudioJobListItem = {
  ...JOB_A,
  id: "job-b",
  projectSlug: "project-b",
  attemptCount: 4,
};

function result(
  job: StudioJobListItem,
  status: StudioJobResult["status"],
  overrides: Partial<StudioJobResult> = {},
): StudioJobResult {
  return {
    jobId: job.id,
    status,
    workflow: job.workflow,
    attemptCount: job.attemptCount + 1,
    pagePath: status === "completed" ? `/projects/${job.projectSlug}` : null,
    projectSlug: job.projectSlug,
    listingId: null,
    // This suite's fixtures model a run that DID publish (the resale lane, or a
    // job processed before unpublished ingestion), because its subject is the
    // published-result affordance. A project ingestion would report "draft".
    publicStatus: status === "completed" ? "published" : null,
    counts: null,
    warnings: [],
    errorCode: status === "failed" ? "object_stat_failed" : null,
    errorStage: status === "failed" ? "object_stat" : null,
    error: status === "failed" ? "Forever could not confirm the uploaded files in storage." : null,
    retryable: status === "failed",
    ...overrides,
  };
}

function overview(
  jobs: StudioJobListItem[],
  activeJobs = 0,
  role: StudioOverview["session"]["role"] = "owner",
): StudioOverview {
  return {
    session: {
      userId: "user-owner",
      email: "owner@example.com",
      role,
      displayName: "Owner",
    },
    capabilities: { archiveUpload: "available" },
    projects: [],
    listings: [],
    jobs,
    members: [],
    activeJobs,
  };
}

function renderDashboard(
  jobs: StudioJobListItem[] = [JOB_A],
  role: StudioOverview["session"]["role"] = "owner",
) {
  endpoints.getOverview.mockResolvedValue(overview(jobs, 0, role));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
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
  return {
    queryClient,
    ...render(<RouterProvider router={router} />),
  };
}

async function settle() {
  await act(async () => {
    for (let flush = 0; flush < 10; flush += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
    for (let flush = 0; flush < 10; flush += 1) await Promise.resolve();
  });
}

function row(jobId = JOB_A.id) {
  return screen.getByTestId(`studio-job-${jobId}`);
}

function retryButton(jobId = JOB_A.id) {
  return within(row(jobId)).getByRole("button", { name: "Retry processing" });
}

async function clickRetry(jobId = JOB_A.id) {
  fireEvent.click(retryButton(jobId));
  await settle();
}

const pageText = () => document.body.textContent ?? "";
const AUTO_BANNER = /this continues\s*automatically even if you close the page/i;

const TIMEOUT_MESSAGE =
  /The Retry request may still be processing, but its final state could not be confirmed\. Refresh the status before attempting any further action\./;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The dashboard's own catch handles rejection; this keeps an unobserved
  // rejection from failing the run before the component attaches its handler.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function refreshButton(jobId = JOB_A.id) {
  return within(row(jobId)).getByRole("button", { name: "Refresh status" });
}

function queryRetryButton(jobId = JOB_A.id) {
  return within(row(jobId)).queryByRole("button", { name: "Retry processing" });
}

describe("Owner-controlled Retry result inspection", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset();
    endpoints.getJobStatus.mockReset();
    endpoints.setProjectPublication.mockReset();
    endpoints.setListingPublication.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(1, 23) immediately published shows success and the safe result action", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "completed"));
    renderDashboard();
    await settle();
    await clickRetry();

    expect(pageText()).toContain("Retry succeeded. The project result is ready.");
    expect(within(row()).getByRole("link", { name: "Open published result" })).toHaveAttribute(
      "href",
      "/projects/project-a",
    );
    expect(endpoints.getJobStatus).not.toHaveBeenCalled();
  });

  it("(2, 20) immediately failed keeps safe fields and makes Retry available", async () => {
    endpoints.processJob.mockResolvedValue(
      result(JOB_A, "failed", { attemptCount: 8, errorCode: "object_stat_failed" }),
    );
    renderDashboard();
    await settle();
    await clickRetry();

    const failure = screen.getByTestId("studio-retry-failure-job-a");
    expect(failure).toHaveTextContent("object_stat_failed");
    expect(failure).toHaveTextContent("attempt 8");
    expect(retryButton()).toBeEnabled();
  });

  it("(3, 13) processing then published polls once and stops on success", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    endpoints.getJobStatus.mockResolvedValue(result(JOB_A, "completed"));
    renderDashboard();
    await settle();
    await clickRetry();

    expect(pageText()).toContain("Retry started. Waiting for the result.");
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(1);
    expect(pageText()).toContain("Retry succeeded. The project result is ready.");

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(1);
  });

  it("(4, 14) processing then failed stops and exposes the current retryable result", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    endpoints.getJobStatus.mockResolvedValue(
      result(JOB_A, "failed", {
        attemptCount: 9,
        errorCode: "media_decode_failed",
        errorStage: "media_decode",
      }),
    );
    renderDashboard();
    await settle();
    await clickRetry();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(screen.getByTestId("studio-retry-failure-job-a")).toHaveTextContent(
      "media_decode_failed · media_decode · attempt 9",
    );
    expect(retryButton()).toBeEnabled();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(1);
  });

  it("(5) processing then terminally nonretryable explains the repair boundary", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    endpoints.getJobStatus.mockResolvedValue(
      result(JOB_A, "failed", {
        retryable: false,
        errorCode: "provider_resolution_failed",
      }),
    );
    renderDashboard();
    await settle();
    await clickRetry();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(pageText()).toMatch(/separately authorized repair is required/i);
    expect(within(row()).queryByRole("button", { name: "Retry processing" })).toBeNull();
  });

  it("missing during observation stops safely and never resubmits", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    const missing = new Error("safe");
    missing.name = "job_not_found";
    endpoints.getJobStatus.mockRejectedValue(missing);
    renderDashboard();
    await settle();
    await clickRetry();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(pageText()).toMatch(/could not be found/i);
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
  });

  it("keeps the manual Retry control Owner-only", async () => {
    renderDashboard([JOB_A], "trusted_publisher");
    await settle();

    expect(within(row()).queryByRole("button", { name: "Retry processing" })).toBeNull();
    expect(endpoints.processJob).not.toHaveBeenCalled();
  });
});

describe("action-specific polling is independent from automatic work", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset().mockResolvedValue(result(JOB_A, "processing"));
    endpoints.getJobStatus.mockReset().mockResolvedValue(result(JOB_A, "processing"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(6, 7, 8) observes with activeJobs zero, no banner, and no automatic resume", async () => {
    renderDashboard();
    await settle();
    await clickRetry();
    await act(async () => vi.advanceTimersByTimeAsync(3_100));

    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(2);
    expect(pageText()).not.toMatch(AUTO_BANNER);
    expect(endpoints.resumePending).not.toHaveBeenCalled();
  });

  it("(9) observes only the selected job", async () => {
    renderDashboard([JOB_A, JOB_B]);
    await settle();
    await clickRetry(JOB_A.id);
    await act(async () => vi.advanceTimersByTimeAsync(3_100));

    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(2);
    expect(endpoints.getJobStatus).toHaveBeenNthCalledWith(1, { data: { jobId: JOB_A.id } });
    expect(endpoints.getJobStatus).toHaveBeenNthCalledWith(2, { data: { jobId: JOB_A.id } });
  });

  it("(19) overview invalidation does not create a duplicate poll loop", async () => {
    const { queryClient } = renderDashboard();
    await settle();
    await clickRetry();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
    });
    const callsAfterInvalidation = endpoints.getJobStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(2_001));
    expect(endpoints.getJobStatus.mock.calls.length - callsAfterInvalidation).toBe(1);
  });

  it("(24) another job remains independently retryable", async () => {
    endpoints.processJob.mockImplementation(({ data }: { data: { jobId: string } }) =>
      Promise.resolve(result(data.jobId === JOB_A.id ? JOB_A : JOB_B, "processing")),
    );
    renderDashboard([JOB_A, JOB_B]);
    await settle();
    await clickRetry(JOB_A.id);

    expect(retryButton(JOB_B.id)).toBeEnabled();
    await clickRetry(JOB_B.id);
    expect(endpoints.processJob).toHaveBeenCalledTimes(2);
    expect(endpoints.processJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { jobId: JOB_A.id } }),
    );
    expect(endpoints.processJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { jobId: JOB_B.id } }),
    );
  });
});

describe("duplicate submission and bounded timer controls", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset();
    endpoints.getJobStatus.mockReset().mockResolvedValue(result(JOB_A, "processing"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(10, 11) disables immediately and a double-click submits one mutation", async () => {
    let resolveMutation!: (value: StudioJobResult) => void;
    endpoints.processJob.mockReturnValue(
      new Promise<StudioJobResult>((resolve) => {
        resolveMutation = resolve;
      }),
    );
    renderDashboard();
    await settle();
    const button = retryButton();

    fireEvent.click(button);
    fireEvent.click(button);
    await settle();

    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
    expect(retryButton()).toBeDisabled();
    expect(pageText()).toContain("Retry started. Waiting for the result.");
    resolveMutation(result(JOB_A, "processing"));
    await settle();
  });

  it("(15, 16, 17) timeout stops observing, preserves processing, and exposes Refresh", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    renderDashboard();
    await settle();
    await clickRetry();
    await act(async () =>
      vi.advanceTimersByTimeAsync(STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs + 1),
    );

    expect(pageText()).toMatch(
      /The Retry request may still be processing, but its final state could not be confirmed\. Refresh the status before attempting any further action\./,
    );
    expect(within(row()).getByText("processing")).toBeInTheDocument();
    expect(within(row()).getByRole("button", { name: "Refresh status" })).toBeEnabled();
    expect(within(row()).queryByRole("button", { name: "Retry processing" })).toBeNull();
    const observationsAtTimeout = endpoints.getJobStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(observationsAtTimeout);
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
  });

  it("Refresh status is read-only and only a confirmed retryable failure reopens Retry", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    renderDashboard();
    await settle();
    await clickRetry();
    await act(async () =>
      vi.advanceTimersByTimeAsync(STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs + 1),
    );
    endpoints.getJobStatus.mockResolvedValueOnce(
      result(JOB_A, "failed", { retryable: true, attemptCount: 8 }),
    );

    fireEvent.click(within(row()).getByRole("button", { name: "Refresh status" }));
    await settle();

    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
    expect(retryButton()).toBeEnabled();
  });

  it("(18) unmount clears both polling and deadline timers", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderDashboard();
    await settle();
    const timersBeforeAction = vi.getTimerCount();
    await clickRetry();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(timersBeforeAction + 2);

    const clearsBeforeUnmount = clearTimeoutSpy.mock.calls.length;
    unmount();
    expect(clearTimeoutSpy.mock.calls.length - clearsBeforeUnmount).toBeGreaterThanOrEqual(2);
    const callsAtUnmount = endpoints.getJobStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs + 1);
    expect(endpoints.getJobStatus).toHaveBeenCalledTimes(callsAtUnmount);
    clearTimeoutSpy.mockRestore();
  });

  it("(25) the closed maximum is bounded inside the 15-minute Owner target", () => {
    expect(STUDIO_OWNER_RETRY_OBSERVATION.initialIntervalMs).toBeGreaterThan(0);
    expect(STUDIO_OWNER_RETRY_OBSERVATION.maximumIntervalMs).toBeGreaterThanOrEqual(
      STUDIO_OWNER_RETRY_OBSERVATION.initialIntervalMs,
    );
    expect(STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs).toBeLessThan(15 * 60 * 1_000);
  });
});

/**
 * FOREVER-PR134-REPAIR-ISOLATION-AND-ABSOLUTE-DEADLINE-001 — PART 3.
 *
 * One absolute deadline, started before the mutation leaves the browser, ends
 * the whole Owner action: submission, the server response, observation and
 * terminal settlement all spend the same budget.
 */
describe("the absolute Owner Retry deadline covers submission and observation", () => {
  const DEADLINE = STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset();
    endpoints.getJobStatus.mockReset().mockResolvedValue(result(JOB_A, "processing"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(1) arms the deadline before the mutation is invoked, not after it answers", async () => {
    const gate = deferred<StudioJobResult>();
    endpoints.processJob.mockReturnValue(gate.promise);
    renderDashboard();
    await settle();

    const timersBefore = vi.getTimerCount();
    await clickRetry();

    // The submission has not answered, yet the action already owns a timer and
    // a cancellation handle: the clock started with the Owner's click.
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
    expect(pageText()).toContain("Retry started. Waiting for the result.");
    expect(vi.getTimerCount()).toBeGreaterThan(timersBefore);
    const submitted = endpoints.processJob.mock.calls[0][0] as { signal?: AbortSignal };
    expect(submitted.signal).toBeInstanceOf(AbortSignal);
    expect(submitted.signal?.aborted).toBe(false);
  });

  it("(2) an immediate published response still settles normally", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "completed"));
    renderDashboard();
    await settle();
    await clickRetry();

    expect(pageText()).toContain("Retry succeeded. The project result is ready.");
    await advance(DEADLINE + 1);
    expect(pageText()).not.toMatch(TIMEOUT_MESSAGE);
  });

  it("(3) an immediate failed response still settles normally", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "failed", { attemptCount: 8 }));
    renderDashboard();
    await settle();
    await clickRetry();

    expect(screen.getByTestId("studio-retry-failure-job-a")).toHaveTextContent("attempt 8");
    await advance(DEADLINE + 1);
    expect(pageText()).not.toMatch(TIMEOUT_MESSAGE);
  });

  it("(4) a slow processing response leaves observation only the remaining budget", async () => {
    const gate = deferred<StudioJobResult>();
    endpoints.processJob.mockReturnValue(gate.promise);
    renderDashboard();
    await settle();
    await clickRetry();

    // Submission consumes four of the fourteen minutes.
    const submitMs = 4 * 60 * 1_000;
    await advance(submitMs);
    gate.resolve(result(JOB_A, "processing"));
    await settle();
    expect(pageText()).toContain("Retry started. Waiting for the result.");

    // Ten minutes minus a beat: still observing, because the budget is shared.
    await advance(DEADLINE - submitMs - 2_000);
    expect(pageText()).not.toMatch(TIMEOUT_MESSAGE);

    await advance(3_000);
    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
  });

  it("(5) a mutation that never settles ends in a bounded truthful state", async () => {
    endpoints.processJob.mockReturnValue(deferred<StudioJobResult>().promise);
    renderDashboard();
    await settle();
    await clickRetry();

    await advance(DEADLINE - 1_000);
    expect(pageText()).not.toMatch(TIMEOUT_MESSAGE);

    await advance(2_000);
    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
    expect(refreshButton()).toBeEnabled();
    const submitted = endpoints.processJob.mock.calls[0][0] as { signal?: AbortSignal };
    expect(submitted.signal?.aborted).toBe(true);
  });

  it("(6) a mutation resolving after the deadline is ignored as stale", async () => {
    const gate = deferred<StudioJobResult>();
    endpoints.processJob.mockReturnValue(gate.promise);
    renderDashboard();
    await settle();
    await clickRetry();
    await advance(DEADLINE + 1);

    gate.resolve(result(JOB_A, "processing"));
    await settle();
    await advance(60_000);

    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
    expect(endpoints.getJobStatus).not.toHaveBeenCalled();
    expect(queryRetryButton()).toBeNull();
    expect(refreshButton()).toBeEnabled();
  });

  it("(7) a published mutation resolving after the deadline never navigates", async () => {
    const gate = deferred<StudioJobResult>();
    endpoints.processJob.mockReturnValue(gate.promise);
    renderDashboard();
    await settle();
    await clickRetry();
    await advance(DEADLINE + 1);

    gate.resolve(result(JOB_A, "completed"));
    await settle();

    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
    expect(within(row()).queryByRole("link", { name: "Open published result" })).toBeNull();
  });

  it("(7b) a mutation rejecting after the deadline is ignored safely", async () => {
    const gate = deferred<StudioJobResult>();
    endpoints.processJob.mockReturnValue(gate.promise);
    renderDashboard();
    await settle();
    await clickRetry();
    await advance(DEADLINE + 1);

    gate.reject(new Error("network"));
    await settle();
    await advance(60_000);

    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
    expect(endpoints.getJobStatus).not.toHaveBeenCalled();
  });

  it("(8, 9, 10) the deadline never marks the job failed, resubmits, or unlocks Retry", async () => {
    endpoints.processJob.mockReturnValue(deferred<StudioJobResult>().promise);
    renderDashboard();
    await settle();
    await clickRetry();
    await advance(DEADLINE + 1);

    expect(within(row()).getByText("processing")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-retry-failure-job-a")).toBeNull();
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
    expect(queryRetryButton()).toBeNull();
    expect(refreshButton()).toBeEnabled();

    await advance(5 * 60 * 1_000);
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
  });

  it("(11) read-only Refresh can discover an eventual published state", async () => {
    endpoints.processJob.mockReturnValue(deferred<StudioJobResult>().promise);
    renderDashboard();
    await settle();
    await clickRetry();
    await advance(DEADLINE + 1);

    endpoints.getJobStatus.mockResolvedValueOnce(result(JOB_A, "completed"));
    fireEvent.click(refreshButton());
    await settle();

    expect(pageText()).toContain("Retry succeeded. The project result is ready.");
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
  });

  it("(12) read-only Refresh can discover an eventual failed state", async () => {
    endpoints.processJob.mockReturnValue(deferred<StudioJobResult>().promise);
    renderDashboard();
    await settle();
    await clickRetry();
    await advance(DEADLINE + 1);

    endpoints.getJobStatus.mockResolvedValueOnce(
      result(JOB_A, "failed", { attemptCount: 8, retryable: true }),
    );
    fireEvent.click(refreshButton());
    await settle();

    expect(screen.getByTestId("studio-retry-failure-job-a")).toHaveTextContent("attempt 8");
    expect(endpoints.processJob).toHaveBeenCalledTimes(1);
  });

  it("(13) unmount clears the submit deadline before any response arrives", async () => {
    endpoints.processJob.mockReturnValue(deferred<StudioJobResult>().promise);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderDashboard();
    await settle();
    await clickRetry();

    const clearsBeforeUnmount = clearTimeoutSpy.mock.calls.length;
    unmount();
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearsBeforeUnmount);
    await vi.advanceTimersByTimeAsync(DEADLINE + 1);
    expect(endpoints.getJobStatus).not.toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("(14) overview invalidation does not reset the absolute deadline", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    const { queryClient } = renderDashboard();
    await settle();
    await clickRetry();

    await advance(DEADLINE - 10_000);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
    });
    await settle();
    expect(pageText()).not.toMatch(TIMEOUT_MESSAGE);

    // The original deadline still lands on time despite the refresh.
    await advance(11_000);
    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
  });

  it("(15) rerendering does not start a fresh deadline", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "processing"));
    renderDashboard();
    await settle();
    await clickRetry();

    await advance(DEADLINE - 10_000);
    // Repeated renders driven by the ordinary polling loop must not re-arm it.
    await settle();
    await settle();
    expect(pageText()).not.toMatch(TIMEOUT_MESSAGE);

    await advance(11_000);
    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
  });

  it("(16) the whole submit-and-observe flow stays inside the 15-minute boundary", async () => {
    endpoints.processJob.mockReturnValue(deferred<StudioJobResult>().promise);
    renderDashboard();
    await settle();

    const startedAt = Date.now();
    await clickRetry();
    await advance(DEADLINE + 1);

    // Terminal, and terminal early enough for the Owner to act inside 15 min.
    expect(pageText()).toMatch(TIMEOUT_MESSAGE);
    expect(Date.now() - startedAt).toBeLessThan(15 * 60 * 1_000);
    expect(DEADLINE).toBeLessThan(15 * 60 * 1_000);
  });
});

describe("safe manual-Retry rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    endpoints.getOverview.mockReset();
    endpoints.resumePending.mockReset().mockResolvedValue({ resumed: 0, results: [] });
    endpoints.processJob.mockReset();
    endpoints.getJobStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(20, 21) renders allowlisted fields, not raw errors or private metadata", async () => {
    endpoints.processJob.mockResolvedValue(
      result(JOB_A, "failed", {
        errorCode: "object_read_failed",
        error:
          "C:\\private\\material-01.pdf r2/object/key https://signed.invalid/?secret=credential",
        attemptCount: 8,
      }),
    );
    renderDashboard();
    await settle();
    await clickRetry();

    expect(pageText()).toContain("object_read_failed");
    expect(pageText()).toContain("attempt 8");
    expect(pageText()).not.toContain("material-01.pdf");
    expect(pageText()).not.toContain("r2/object/key");
    expect(pageText()).not.toContain("signed.invalid");
    expect(pageText()).not.toContain("credential");
  });

  it("(22) never asks for file selection or re-upload", async () => {
    endpoints.processJob.mockResolvedValue(result(JOB_A, "completed"));
    renderDashboard();
    await settle();
    await clickRetry();

    expect(pageText()).not.toMatch(/re-?upload|reselect|choose files/i);
    expect(endpoints.processJob).toHaveBeenCalledWith(
      expect.objectContaining({ data: { jobId: JOB_A.id } }),
    );
  });
});
