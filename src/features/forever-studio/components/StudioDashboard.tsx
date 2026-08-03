/**
 * Forever Studio dashboard: catalogue state, quick workflow entry points,
 * recent upload jobs, and (for the Owner) publisher management.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { beginConsequentialAction } from "@/lib/stale-asset/write-safety";

import {
  studioGetJobStatus,
  studioGetOverview,
  studioProcessJob,
  studioResumePending,
  studioSetListingPublication,
  studioSetProjectPublication,
} from "../studio.functions";
import {
  projectPagePath,
  resalePagePath,
  STUDIO_WORKFLOW_LABELS,
  STUDIO_WORKFLOWS,
  type StudioJobListItem,
  type StudioJobResult,
  type StudioWorkflow,
} from "../studio-types";
import {
  nextOwnerRetryInterval,
  ownerRetryIsBusy,
  STUDIO_OWNER_RETRY_OBSERVATION,
  type StudioOwnerRetryView,
} from "./manual-retry-observation";
import { useStudioSession } from "./useStudioSession";
import {
  isStudioRouteDenial,
  StudioRouteDenied,
  StudioRouteUnavailable,
} from "./StudioRouteDenied";

export const STUDIO_OVERVIEW_KEY = ["studio", "overview"] as const;

const WORKFLOW_HINTS: Record<StudioWorkflow, string> = {
  new_development: "Brochure, price list, plans, photos — publish a new project.",
  project_update: "Add or correct materials on an existing project.",
  price_availability_update: "New price list or availability change.",
  construction_media_update: "Construction progress photos and videos.",
  resale_listing: "Photos plus price, bedrooms, area, location.",
};

function statusBadge(status: string) {
  const published = status === "published";
  return (
    <Badge variant={published ? "default" : "secondary"}>
      {published ? "Published" : status === "draft" ? "Draft" : status}
    </Badge>
  );
}

export function StudioDashboard() {
  const queryClient = useQueryClient();
  const session = useStudioSession();
  // The overview includes member-only jobs and must never reuse a prior
  // publisher's query result while an authentication transition completes.
  const overviewKey = [
    ...STUDIO_OVERVIEW_KEY,
    session.status === "signed_in" ? session.userId : "signed_out",
  ] as const;
  const overview = useQuery({
    queryKey: overviewKey,
    queryFn: () => studioGetOverview(),
    retry: false,
    enabled: session.status === "signed_in",
    // Poll while any job is still working so status stays live and durable
    // resume is visible without a manual refresh.
    refetchInterval: (query) =>
      query.state.data && query.state.data.activeJobs > 0 ? 5000 : false,
  });

  // Automatic durable resume: on each poll, ask the server to pick up only
  // explicitly-ready received / retryable-failed / stale-processing jobs.
  const activeJobs = overview.data?.activeJobs ?? 0;
  useEffect(() => {
    if (activeJobs <= 0) return;
    let cancelled = false;
    void studioResumePending({ data: undefined })
      .then(() => {
        if (!cancelled) void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeJobs, overview.dataUpdatedAt, queryClient]);

  /**
   * One local record and one bounded timer pair per Retry the Owner explicitly
   * starts. These refs survive ordinary renders and overview invalidations;
   * no effect derives a new loop from query data, so a refresh cannot duplicate
   * an existing poller.
   *
   * `deadlineTimer` is the ONE absolute deadline for the whole Owner action. It
   * is armed synchronously before the mutation is sent and is never replaced,
   * so submission and observation spend the same budget: a submit that never
   * settles cannot sit in `submitting` forever, and a submit that took four
   * minutes leaves observation ten, not another fourteen.
   */
  type OwnerRetryTimers = {
    pollTimer: ReturnType<typeof setTimeout> | null;
    deadlineTimer: ReturnType<typeof setTimeout>;
    nextIntervalMs: number;
    /** Set before the local action is abandoned, so a late response is ignored. */
    expired: boolean;
    /** Stops the browser waiting locally. Never proof the server did not run. */
    abort: AbortController | null;
    /**
     * Consequential-action registrations (FOREVER-STUDIO-STALE-ASSET-RECOVERY-001).
     * While either is held, an automatic stale-asset reload is REFUSED — a
     * reload during an unconfirmed Retry could become a second Retry, which
     * this lane exists to make impossible.
     */
    releaseSubmit: (() => void) | null;
    releaseObserve: (() => void) | null;
  };

  const [ownerRetries, setOwnerRetries] = useState<Record<string, StudioOwnerRetryView>>({});
  const ownerRetriesRef = useRef<Record<string, StudioOwnerRetryView>>({});
  const retryLocksRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const retryTimersRef = useRef(new Map<string, OwnerRetryTimers>());

  const putOwnerRetry = (jobId: string, view: StudioOwnerRetryView) => {
    ownerRetriesRef.current = { ...ownerRetriesRef.current, [jobId]: view };
    if (mountedRef.current) setOwnerRetries(ownerRetriesRef.current);
  };

  const clearOwnerRetryTimers = (jobId: string) => {
    const timers = retryTimersRef.current.get(jobId);
    if (!timers) return;
    if (timers.pollTimer) clearTimeout(timers.pollTimer);
    clearTimeout(timers.deadlineTimer);
    // Every terminal path funnels through here, so this is the one place the
    // consequential-action registrations are released.
    timers.releaseSubmit?.();
    timers.releaseObserve?.();
    retryTimersRef.current.delete(jobId);
  };

  useEffect(
    () => () => {
      mountedRef.current = false;
      for (const jobId of retryTimersRef.current.keys()) clearOwnerRetryTimers(jobId);
      retryLocksRef.current.clear();
    },
    [],
  );

  /**
   * The Owner-controlled lane, reachable from job history.
   *
   * A job whose automatic budget is spent is no longer picked up in the
   * background — by design. Without a control here the only way to move it
   * would be direct SQL, which is exactly the manual intervention the bounded
   * retry policy exists to remove. `studioProcessJob` is the same controlled
   * attempt the uploader makes: it never resets `attempt_count`, and one
   * request wins if several are made.
   */
  const retryJob = useMutation({
    mutationFn: (input: { jobId: string; signal?: AbortSignal }) =>
      studioProcessJob({ data: { jobId: input.jobId }, signal: input.signal }),
  });

  const invalidateOverview = () =>
    void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });

  const settleOwnerRetry = (result: StudioJobResult): boolean => {
    if (result.status === "published") {
      clearOwnerRetryTimers(result.jobId);
      putOwnerRetry(result.jobId, {
        phase: "published",
        status: "published",
        message: "Retry succeeded. The project result is ready.",
        errorCode: null,
        errorStage: null,
        attemptCount: result.attemptCount,
        retryable: false,
        pagePath: result.pagePath,
      });
      retryLocksRef.current.delete(result.jobId);
      invalidateOverview();
      return true;
    }
    if (result.status === "failed") {
      clearOwnerRetryTimers(result.jobId);
      const terminal = !result.retryable;
      putOwnerRetry(result.jobId, {
        phase: terminal ? "terminally_nonretryable" : "failed",
        status: "failed",
        message: terminal
          ? "This job is terminally nonretryable. A separately authorized repair is required before Retry can be used."
          : "The retry finished safely but did not publish. Review the code below before retrying.",
        errorCode: result.errorCode,
        errorStage: result.errorStage,
        attemptCount: result.attemptCount,
        retryable: result.retryable,
        pagePath: null,
      });
      if (result.retryable) retryLocksRef.current.delete(result.jobId);
      invalidateOverview();
      return true;
    }
    return false;
  };

  const markOwnerRetryMissing = (jobId: string) => {
    clearOwnerRetryTimers(jobId);
    const prior = ownerRetriesRef.current[jobId];
    putOwnerRetry(jobId, {
      phase: "missing",
      status: prior?.status ?? "failed",
      message: "This upload job could not be found. No further Retry was submitted.",
      errorCode: "job_not_found",
      errorStage: null,
      attemptCount: prior?.attemptCount ?? 0,
      retryable: false,
      pagePath: null,
    });
    retryLocksRef.current.delete(jobId);
  };

  /**
   * The single truthful end state for an action that ran out of budget.
   *
   * It never claims the job failed and never claims the server did not receive
   * the request: an unconfirmed Retry is exactly that, and the only honest next
   * step is a read-only status refresh.
   */
  const markOwnerRetryTimeout = (jobId: string) => {
    clearOwnerRetryTimers(jobId);
    const prior = ownerRetriesRef.current[jobId];
    putOwnerRetry(jobId, {
      phase: "timeout",
      status: prior?.status ?? "processing",
      message:
        "The Retry request may still be processing, but its final state could not be confirmed. Refresh the status before attempting any further action.",
      errorCode: prior?.errorCode ?? null,
      errorStage: prior?.errorStage ?? null,
      attemptCount: prior?.attemptCount ?? 0,
      retryable: false,
      pagePath: prior?.pagePath ?? null,
    });
    // Deliberately retain the per-job lock. Only a read-only Refresh that
    // observes a retryable failure may make another Retry available.
  };

  /**
   * The absolute deadline expiring — during submission or during observation.
   *
   * `expired` is set and the request is cancelled BEFORE the local state moves,
   * so the original promise settling afterwards is recognized as stale and
   * ignored rather than reviving a poller, unlocking Retry, or navigating.
   * Cancelling stops the browser waiting; it is never evidence about what the
   * server did.
   */
  const expireOwnerRetry = (jobId: string) => {
    const timers = retryTimersRef.current.get(jobId);
    if (timers) {
      timers.expired = true;
      timers.abort?.abort();
    }
    markOwnerRetryTimeout(jobId);
  };

  const observeOwnerRetry = (jobId: string, initial: StudioJobResult, timers: OwnerRetryTimers) => {
    // The submission is settled but the JOB is not, so the action stays
    // consequential: an automatic reload here would abandon an observation
    // whose outcome nothing else is watching.
    timers.releaseObserve ??= beginConsequentialAction("owner_retry_observe");
    putOwnerRetry(jobId, {
      phase: "observing",
      status: initial.status,
      message: "Retry started. Waiting for the result.",
      errorCode: initial.errorCode,
      errorStage: initial.errorStage,
      attemptCount: initial.attemptCount,
      retryable: false,
      pagePath: initial.pagePath,
    });

    // No new deadline. The one armed before the mutation is still running, so
    // observation receives only the remaining budget.
    const schedule = () => {
      const current = retryTimersRef.current.get(jobId);
      if (current !== timers || current.expired) return;
      const interval = current.nextIntervalMs;
      current.pollTimer = setTimeout(async () => {
        if (retryTimersRef.current.get(jobId) !== current) return;
        try {
          const result = await studioGetJobStatus({ data: { jobId } });
          if (retryTimersRef.current.get(jobId) !== current) return;
          if (settleOwnerRetry(result)) return;
          putOwnerRetry(jobId, {
            phase: "observing",
            status: result.status,
            message: "Retry started. Waiting for the result.",
            errorCode: result.errorCode,
            errorStage: result.errorStage,
            attemptCount: result.attemptCount,
            retryable: false,
            pagePath: result.pagePath,
          });
        } catch (error) {
          if (retryTimersRef.current.get(jobId) !== current) return;
          if (error instanceof Error && error.name === "job_not_found") {
            markOwnerRetryMissing(jobId);
            return;
          }
          // A transient observation failure is not a processing failure. Keep
          // the true last-known state and let the bounded deadline decide.
        }
        current.nextIntervalMs = nextOwnerRetryInterval(interval);
        schedule();
      }, interval);
    };
    schedule();
  };

  const startOwnerRetry = async (job: StudioJobListItem) => {
    // Synchronous per-job mutex: this closes the pre-render double-click gap.
    if (retryLocksRef.current.has(job.id)) return;
    retryLocksRef.current.add(job.id);
    putOwnerRetry(job.id, {
      phase: "submitting",
      status: "processing",
      message: "Retry started. Waiting for the result.",
      errorCode: job.errorCode,
      errorStage: job.errorStage,
      attemptCount: job.attemptCount,
      retryable: false,
      pagePath: null,
    });

    // The absolute deadline is armed HERE, synchronously, before the request
    // is sent. A mutation that never settles is therefore bounded by the same
    // ceiling as an observation that never terminates.
    clearOwnerRetryTimers(job.id);
    const timers: OwnerRetryTimers = {
      pollTimer: null,
      deadlineTimer: setTimeout(
        () => expireOwnerRetry(job.id),
        STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs,
      ),
      nextIntervalMs: STUDIO_OWNER_RETRY_OBSERVATION.initialIntervalMs,
      expired: false,
      abort: typeof AbortController === "function" ? new AbortController() : null,
      // Registered BEFORE the request leaves. The dangerous window opens the
      // moment the browser might have sent something, not when a response
      // arrives.
      releaseSubmit: beginConsequentialAction("owner_retry_submit"),
      releaseObserve: null,
    };
    retryTimersRef.current.set(job.id, timers);

    try {
      const result = await retryJob.mutateAsync({ jobId: job.id, signal: timers.abort?.signal });
      // A response that arrives after the deadline is a stale action response.
      // It does not restart polling, unlock Retry, or navigate; only the
      // read-only Refresh path may establish current truth.
      // The submit itself has settled; observation (registered below) carries
      // the action from here.
      timers.releaseSubmit?.();
      timers.releaseSubmit = null;
      if (retryTimersRef.current.get(job.id) !== timers || timers.expired) return;
      if (!settleOwnerRetry(result)) observeOwnerRetry(job.id, result, timers);
    } catch (error) {
      timers.releaseSubmit?.();
      timers.releaseSubmit = null;
      if (retryTimersRef.current.get(job.id) !== timers || timers.expired) return;
      if (error instanceof Error && error.name === "job_not_found") {
        markOwnerRetryMissing(job.id);
      } else {
        // The mutation may have reached the server even if its response did
        // not reach the browser. Never submit it again automatically.
        markOwnerRetryTimeout(job.id);
      }
    }
  };

  const refreshOwnerRetryStatus = async (jobId: string) => {
    const prior = ownerRetriesRef.current[jobId];
    if (!prior || prior.phase === "refreshing") return;
    putOwnerRetry(jobId, {
      ...prior,
      phase: "refreshing",
      message: "Refreshing the exact job status…",
    });
    try {
      const result = await studioGetJobStatus({ data: { jobId } });
      if (!settleOwnerRetry(result)) markOwnerRetryTimeout(jobId);
    } catch (error) {
      if (error instanceof Error && error.name === "job_not_found") markOwnerRetryMissing(jobId);
      else markOwnerRetryTimeout(jobId);
    }
  };

  // Publication is consequential: it changes what the public site shows. While
  // one is in flight an automatic stale-asset reload is refused, and after a
  // manual reload nothing republishes on its own.
  const projectPublication = useMutation({
    mutationFn: async (input: { slug: string; publish: boolean }) => {
      const release = beginConsequentialAction("publication");
      try {
        return await studioSetProjectPublication({ data: input });
      } finally {
        release();
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
  });
  const listingPublication = useMutation({
    mutationFn: async (input: { listingId: string; publish: boolean }) => {
      const release = beginConsequentialAction("publication");
      try {
        return await studioSetListingPublication({ data: input });
      } finally {
        release();
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
  });

  if (session.status !== "signed_in" || overview.isPending) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading Studio…</p>;
  }
  if (overview.isError) {
    // Only a server-proven denial settles as denied; a transient fetch or
    // lookup failure (offline, flaky reconnect) stays retryable.
    return isStudioRouteDenial(overview.error) ? (
      <StudioRouteDenied />
    ) : (
      <StudioRouteUnavailable onRetry={() => void overview.refetch()} />
    );
  }

  const data = overview.data;
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold">
          {data.session.displayName ?? data.session.email ?? "Publisher"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.session.role === "owner" ? "Owner" : "Trusted Publisher"} · an upload publishes
          immediately; missing details can be added later.
        </p>
        {data.activeJobs > 0 ? (
          <p className="mt-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Processing {data.activeJobs} upload{data.activeJobs === 1 ? "" : "s"}… this continues
            automatically even if you close the page.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Add or update
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {STUDIO_WORKFLOWS.map((workflow) => (
            <Link
              key={workflow}
              to="/studio/upload"
              search={{ workflow, slug: undefined }}
              className="rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/60"
            >
              <p className="font-medium">{STUDIO_WORKFLOW_LABELS[workflow]}</p>
              <p className="mt-1 text-sm text-muted-foreground">{WORKFLOW_HINTS[workflow]}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Projects
        </h2>
        {data.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">{project.slug}</p>
                </div>
                {statusBadge(project.publicStatus)}
                <div className="flex flex-wrap gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <a href={projectPagePath(project.slug)} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/studio/project/$slug" params={{ slug: project.slug }}>
                      Edit
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      to="/studio/upload"
                      search={{ workflow: "project_update", slug: project.slug }}
                    >
                      Upload update
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={projectPublication.isPending}
                    onClick={() =>
                      projectPublication.mutate({
                        slug: project.slug,
                        publish: project.publicStatus !== "published",
                      })
                    }
                  >
                    {project.publicStatus === "published" ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Resale listings
        </h2>
        {data.listings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No resale listings yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.listings.map((listing) => (
              <li
                key={listing.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{listing.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {listing.price != null
                      ? `${listing.price.toLocaleString()}${listing.currency ? ` ${listing.currency}` : ""}`
                      : "Price on request"}
                  </p>
                </div>
                {statusBadge(listing.publicationStatus)}
                <div className="flex flex-wrap gap-1">
                  {listing.slug ? (
                    <Button asChild variant="ghost" size="sm">
                      <a href={resalePagePath(listing.slug)} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/studio/resale/$id" params={{ id: listing.id }}>
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={listingPublication.isPending}
                    onClick={() =>
                      listingPublication.mutate({
                        listingId: listing.id,
                        publish: listing.publicationStatus !== "published",
                      })
                    }
                  >
                    {listing.publicationStatus === "published" ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Recent uploads
        </h2>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No uploads yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.jobs.map((job) => {
              const ownerRetry = ownerRetries[job.id];
              const displayStatus = ownerRetry?.status ?? job.status;
              const retryAvailable =
                data.session.role === "owner" &&
                (ownerRetry
                  ? ownerRetryIsBusy(ownerRetry) ||
                    (ownerRetry.phase === "failed" && ownerRetry.retryable)
                  : job.status === "failed" && job.retryable);
              return (
                <li
                  key={job.id}
                  data-testid={`studio-job-${job.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 px-3 py-2"
                >
                  <span className="flex-1 truncate">
                    {STUDIO_WORKFLOW_LABELS[job.workflow]}
                    {job.projectSlug ? ` · ${job.projectSlug}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{job.creatorEmail ?? ""}</span>
                  <Badge
                    variant={
                      displayStatus === "published"
                        ? "default"
                        : displayStatus === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {displayStatus}
                  </Badge>
                  {job.status === "failed" ? (
                    <span
                      data-testid={`studio-job-failure-${job.id}`}
                      className="w-full text-xs text-muted-foreground"
                    >
                      {/*
                      A job the automatic lane has given up on must SAY so, and
                      say it here rather than by quietly vanishing. The safe
                      code and the true attempt count are exactly what makes the
                      failure explicable; neither is ever rewritten.
                    */}
                      {job.errorCode ?? "unknown_error"}
                      {job.errorStage ? ` · ${job.errorStage}` : ""} · attempt {job.attemptCount}
                      {job.automaticRetry === "exhausted"
                        ? " · automatic retries stopped — retry when you are ready"
                        : ""}
                    </span>
                  ) : null}
                  {retryAvailable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ownerRetryIsBusy(ownerRetry)}
                      onClick={() => void startOwnerRetry(job)}
                    >
                      Retry processing
                    </Button>
                  ) : null}
                  {ownerRetry ? (
                    <div
                      data-testid={`studio-retry-observation-${job.id}`}
                      className="w-full space-y-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                      role="status"
                    >
                      <p>{ownerRetry.message}</p>
                      {ownerRetry.phase === "failed" ||
                      ownerRetry.phase === "terminally_nonretryable" ? (
                        <p data-testid={`studio-retry-failure-${job.id}`}>
                          {ownerRetry.errorCode ?? "unknown_error"}
                          {ownerRetry.errorStage ? ` · ${ownerRetry.errorStage}` : ""} · attempt{" "}
                          {ownerRetry.attemptCount}
                        </p>
                      ) : null}
                      {ownerRetry.phase === "published" && ownerRetry.pagePath ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={ownerRetry.pagePath}>Open published result</a>
                        </Button>
                      ) : null}
                      {ownerRetry.phase === "timeout" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void refreshOwnerRetryStatus(job.id)}
                        >
                          Refresh status
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data.session.role === "owner" ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Publishers
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.members.filter((member) => member.isActive).length} active member(s).
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/studio/members">Manage publishers</Link>
          </Button>
        </section>
      ) : null}
    </div>
  );
}
