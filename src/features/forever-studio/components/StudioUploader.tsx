/**
 * Forever Studio upload flow — the heart of FOREVER-STUDIO-001.
 *
 * One coherent path on phone, tablet, and desktop:
 *   pick workflow → add what exists (files, a few facts) → Publish now.
 *
 * Files go straight from the device to storage via short-lived signed
 * upload tokens issued by the authorized server boundary; processing and
 * publication then happen server-side in one call. A failed step leaves a
 * retryable job — nothing uploaded is ever lost.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

import { studioGetOverview, studioProcessJob, studioStartJob } from "../studio.functions";
import {
  additionalMaterialWindows,
  LARGE_ARCHIVE_MAX_BYTES,
  primaryMaterialWindows,
  STUDIO_MATERIAL_GROUPS,
  STUDIO_WORKFLOW_LABELS,
  STUDIO_WORKFLOWS,
  type StudioJobProgress,
  type StudioJobResult,
  type StudioMaterialGroup,
  type StudioMaterialPurpose,
  type StudioMaterialWindow,
  type StudioProjectFacts,
  type StudioResaleFacts,
  type StudioUploadTarget,
  type StudioWorkflow,
} from "../studio-types";
import {
  archiveTooLarge,
  isLargeArchive,
  uploadLargeArchive,
  type ArchiveUploadProgress,
} from "./archive-upload";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";
import {
  isStudioRouteDenial,
  StudioRouteDenied,
  StudioRouteUnavailable,
} from "./StudioRouteDenied";

/**
 * One file the Owner put into one upload window.
 *
 * The window IS the instruction: `purpose` travels with the file from the
 * moment it is chosen, through the start-job request, to the server. Nothing
 * downstream re-reads the filename to decide what the material is, and adding
 * or removing other files never disturbs a selection's purpose.
 */
interface MaterialSelection {
  file: File;
  purpose: StudioMaterialPurpose;
  /** Stable identity so React keys survive removals of earlier entries. */
  key: string;
}

/** Continuation cadence while the page stays open on a sliced job. */
const PROCESS_POLL_MS = 3000;

/**
 * Consecutive status polls allowed to resolve WITHOUT a readable job result
 * before the page stops polling and explains itself. Seen on Android during
 * network handover: a poll's transport can resolve with no deserialized body
 * (no thrown error, no result). One unreadable poll must never crash the
 * page or masquerade as a processing failure — the job itself continues
 * server-side regardless of this page's polling.
 */
const MAX_UNREADABLE_STATUS_POLLS = 5;

/**
 * Shape guard for a processing-status poll. The server function always
 * returns a StudioJobResult, but the TRANSPORT can resolve with something
 * else on flaky mobile networks (undefined, or a raw non-JSON response) —
 * exactly what produced "Cannot read properties of undefined (reading
 * 'status')" during the Android staging retest. Never dereference `.status`
 * without this proof.
 */
function isJobResult(value: unknown): value is StudioJobResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

/**
 * Pair every signed target with the exact File it was issued for.
 *
 * The pairing key is the server's `fileIndex`, which is that file's position in
 * the manifest the browser just sent and the index embedded in its private
 * staging path. Never the filename (two windows may legitimately hold the same
 * name) and never array order (a reordered response must stay correct).
 *
 * All-or-nothing on purpose: a response that is not a clean one-to-one mapping
 * means the browser cannot know whose bytes belong where, and uploading
 * anything at that point risks publishing one file under another file's
 * Owner-selected purpose. The refusal names no path and no token.
 */
function resolveUploadPairs(
  targets: StudioUploadTarget[],
  ordinary: MaterialSelection[],
): Array<{ target: StudioUploadTarget; file: File }> {
  const claimed = new Set<number>();
  const pairs: Array<{ target: StudioUploadTarget; file: File }> = [];
  for (const target of targets) {
    const fileIndex = target?.fileIndex;
    if (
      !Number.isInteger(fileIndex) ||
      fileIndex < 0 ||
      fileIndex >= ordinary.length ||
      claimed.has(fileIndex)
    ) {
      throw new Error(
        "Forever could not match an upload slot to the file you chose, so nothing was uploaded. Please try again.",
      );
    }
    claimed.add(fileIndex);
    pairs.push({ target, file: ordinary[fileIndex].file });
  }
  return pairs;
}

type Phase =
  | { step: "form" }
  | { step: "uploading"; done: number; total: number }
  | {
      step: "uploadingArchive";
      archiveIndex: number;
      archiveCount: number;
      fileName: string;
      progress: ArchiveUploadProgress;
    }
  | { step: "processing" }
  | { step: "archiveProcessing"; jobId: string; progress: StudioJobProgress | null }
  | { step: "ready" }
  | { step: "result"; result: StudioJobResult; failedUploads: string[] }
  | { step: "error"; message: string; jobId: string | null; stage: "upload" | "processing" };

export function StudioUploader(props: { workflow?: StudioWorkflow; slug?: string }) {
  const queryClient = useQueryClient();
  const [workflow, setWorkflow] = useState<StudioWorkflow>(props.workflow ?? "new_development");
  const [projectSlug, setProjectSlug] = useState(props.slug ?? "");
  const [selections, setSelections] = useState<MaterialSelection[]>([]);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [projectFacts, setProjectFacts] = useState<StudioProjectFacts>({});
  const [resaleFacts, setResaleFacts] = useState<StudioResaleFacts>({});
  // Monotonic counter for selection keys: two files with the same name in the
  // same window must stay independently removable.
  const nextKey = useRef(0);
  // The sliced-continuation loop must stop driving the server when this
  // page unmounts; durable resume takes over from any Studio session.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Existing projects for the update workflows (same cached overview call).
  const overview = useQuery({
    queryKey: STUDIO_OVERVIEW_KEY,
    queryFn: () => studioGetOverview(),
    retry: false,
  });
  const isResale = workflow === "resale_listing";
  const isUpdate =
    workflow === "project_update" ||
    workflow === "price_availability_update" ||
    workflow === "construction_media_update";

  if (overview.isError) {
    // Only a server-proven denial settles as denied; a transient fetch or
    // lookup failure (offline, flaky reconnect) stays retryable.
    return isStudioRouteDenial(overview.error) ? (
      <StudioRouteDenied />
    ) : (
      <StudioRouteUnavailable onRetry={() => void overview.refetch()} />
    );
  }

  /** Every file added through a window is stamped with THAT window's purpose. */
  const addFiles = (incoming: FileList | null, purpose: StudioMaterialPurpose) => {
    if (!incoming) return;
    const added = Array.from(incoming).map((file) => {
      nextKey.current += 1;
      return { file, purpose, key: `${purpose}-${nextKey.current}` };
    });
    if (!added.length) return;
    setSelections((current) => [...current, ...added]);
  };

  /** Removing one file leaves every other selection — and its purpose — intact. */
  const removeSelection = (key: string) => {
    setSelections((current) => current.filter((selection) => selection.key !== key));
  };

  const runJob = async (jobId?: string) => {
    let id = jobId ?? null;
    // Which boundary a thrown failure belongs to: an upload-stage failure
    // must offer "Resume upload" (replan + missing parts only), never a
    // processing request against an archive with parts still missing.
    let stage: "upload" | "processing" = "upload";
    try {
      const failedUploads: string[] = [];
      // Which transport lane a file takes is a SIZE decision, never a purpose
      // decision. Both lanes therefore keep the WHOLE selection — file plus the
      // window the Owner chose — and a large archive is never reduced to a bare
      // File on its way to the resumable lane. Its purpose crosses the wire on
      // the plan request exactly as an ordinary file's crosses on start-job.
      const largeArchives = selections.filter((selection) => isLargeArchive(selection.file));
      const ordinary = selections.filter((selection) => !isLargeArchive(selection.file));
      const oversized = largeArchives.map((selection) => selection.file).find(archiveTooLarge);
      if (!id && oversized) {
        setPhase({
          step: "error",
          message: `${oversized.name} is larger than ${Math.round(LARGE_ARCHIVE_MAX_BYTES / (1024 * 1024))} MB. Split the archive and try again.`,
          jobId: null,
          stage: "upload",
        });
        return;
      }
      if (!id) {
        const started = await studioStartJob({
          data: {
            workflow,
            projectSlug: projectSlug.trim() || undefined,
            projectFacts: isResale ? undefined : projectFacts,
            resaleFacts: isResale ? resaleFacts : undefined,
            // The Owner's chosen window crosses the wire with every file.
            files: ordinary.map((selection) => ({
              name: selection.file.name,
              size: selection.file.size,
              contentType: selection.file.type || undefined,
              materialPurpose: selection.purpose,
            })),
          },
        });
        id = started.jobId;
        // Resolve the WHOLE mapping before a single byte is sent. Bytes are
        // paired to signed targets by the SERVER-ASSIGNED fileIndex, never by
        // position in this array and never by filename, so response order is
        // free, duplicate filenames stay distinct, and the same File selected
        // under two windows keeps two separate targets. Anything that is not a
        // sound one-to-one mapping — a missing, non-integer, out-of-range or
        // repeated identity — aborts the upload with nothing uploaded, rather
        // than sending one file's bytes to another file's staging path.
        const pairs = resolveUploadPairs(started.uploads, ordinary);
        setPhase({ step: "uploading", done: 0, total: pairs.length });
        for (let index = 0; index < pairs.length; index += 1) {
          const { target, file } = pairs[index];
          const { error } = await supabase.storage
            .from(target.bucket)
            .uploadToSignedUrl(target.path, target.token, file, {
              contentType: file.type || undefined,
            });
          if (error) failedUploads.push(target.name);
          setPhase({ step: "uploading", done: index + 1, total: pairs.length });
        }
      }
      // Large archives: resumable chunked upload, one archive at a time.
      // Runs on EVERY attempt — fresh or retried job — because re-planning
      // the identical manifest resumes the same archive with only its
      // missing parts. Processing is never requested past this loop until
      // every archive reached storage acceptance.
      for (let index = 0; index < largeArchives.length; index += 1) {
        const { file, purpose } = largeArchives[index];
        try {
          await uploadLargeArchive(id, file, purpose, (progress) => {
            if (!alive.current) return;
            setPhase({
              step: "uploadingArchive",
              archiveIndex: index,
              archiveCount: largeArchives.length,
              fileName: file.name,
              progress,
            });
          });
        } catch (error) {
          // A retried job that already published cannot re-plan; fall
          // through to the processing call, which reports the final result.
          if (error instanceof Error && error.name === "job_already_published") break;
          throw error;
        }
      }
      stage = "processing";
      setPhase({ step: "processing" });
      // Every poll result passes the shape guard before ANY dereference: a
      // transport hiccup that resolves without a readable result is an
      // unreadable poll — the page keeps its current processing view and
      // polls again — never a crash and never a fake failure.
      const pollProcessing = async (): Promise<StudioJobResult | null> => {
        const polled: unknown = await studioProcessJob({ data: { jobId: id! } });
        return isJobResult(polled) ? polled : null;
      };
      let result = await pollProcessing();
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
      // Sliced continuation: while this page stays open it keeps driving the
      // job; after it closes, any Studio session's dashboard poll (or a
      // scheduled caller) resumes the durable work automatically.
      let unreadablePolls = result === null ? 1 : 0;
      while ((result === null || result.status === "processing") && alive.current) {
        if (unreadablePolls > MAX_UNREADABLE_STATUS_POLLS) {
          // The processing request itself was accepted (this stage begins
          // only after storage acceptance), so the job continues durably —
          // only this page's view of it is unreadable.
          throw new Error(
            "Processing continues on the server, but its status could not be read from this page. You can close this page safely — Forever resumes the job automatically.",
          );
        }
        if (result !== null) {
          setPhase({ step: "archiveProcessing", jobId: id, progress: result.progress ?? null });
        }
        await new Promise((resolve) => setTimeout(resolve, PROCESS_POLL_MS));
        if (!alive.current) return;
        result = await pollProcessing();
        unreadablePolls = result === null ? unreadablePolls + 1 : 0;
      }
      if (!alive.current || result === null) return;
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
      if (result.status === "failed") {
        setPhase({
          step: "error",
          message: result.error ?? "Processing failed.",
          jobId: id,
          stage: "processing",
        });
      } else if (result.status !== "published") {
        setPhase({ step: "ready" });
      } else {
        setPhase({ step: "result", result, failedUploads });
      }
    } catch (error) {
      setPhase({
        step: "error",
        message: error instanceof Error ? error.message : String(error),
        jobId: id,
        stage,
      });
    }
  };

  if (phase.step === "uploading") {
    return (
      <StatusPanel
        title={`Uploading ${phase.done}/${phase.total}…`}
        body="Keep this page open until every file finishes and the processing request reaches the server. Closing now leaves the upload private and it will not publish automatically."
      />
    );
  }
  if (phase.step === "uploadingArchive") {
    return <ArchiveUploadPanel phase={phase} />;
  }
  if (phase.step === "archiveProcessing") {
    return <ArchiveProcessingPanel progress={phase.progress} />;
  }
  if (phase.step === "processing") {
    return (
      <StatusPanel
        title="Publishing…"
        body="Keep this page open until Forever confirms the processing request. After that confirmation, an interrupted job resumes automatically."
      />
    );
  }
  if (phase.step === "ready") {
    return (
      <StatusPanel
        title="Processing request confirmed"
        body="The server recorded that uploading is complete. You can safely close this page; Forever will resume this job automatically if its current worker is interrupted."
      />
    );
  }
  if (phase.step === "result") {
    return <ResultPanel result={phase.result} failedUploads={phase.failedUploads} />;
  }
  if (phase.step === "error") {
    return (
      <div className="mx-auto max-w-md space-y-4 py-12 text-center">
        <h2 className="text-lg font-semibold">Not published yet</h2>
        <p className="text-sm text-muted-foreground">{phase.message}</p>
        <p className="text-xs text-muted-foreground">
          {phase.stage === "upload"
            ? "Uploaded parts are kept privately. Resume to upload only what is still missing — nothing restarts from zero, and nothing publishes until every part is safely stored."
            : "Uploaded files remain private. Retry to confirm processing; a job that never reaches that boundary will not publish automatically."}
        </p>
        <div className="flex justify-center gap-2">
          {phase.jobId ? (
            <Button onClick={() => void runJob(phase.jobId!)}>
              {phase.stage === "upload" ? "Resume upload" : "Retry processing"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setPhase({ step: "form" })}>
            Back to the form
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void runJob();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="studio-workflow">What are you adding?</Label>
        <select
          id="studio-workflow"
          className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          value={workflow}
          onChange={(event) => setWorkflow(event.target.value as StudioWorkflow)}
        >
          {STUDIO_WORKFLOWS.map((value) => (
            <option key={value} value={value}>
              {STUDIO_WORKFLOW_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {isUpdate ? (
        <div className="space-y-2">
          <Label htmlFor="studio-project">Project</Label>
          <select
            id="studio-project"
            className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            value={projectSlug}
            onChange={(event) => setProjectSlug(event.target.value)}
          >
            <option value="">Choose a project…</option>
            {(overview.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!isResale && !isUpdate ? (
        <ProjectFactsFields facts={projectFacts} onChange={setProjectFacts} />
      ) : null}
      {isResale ? <ResaleFactsFields facts={resaleFacts} onChange={setResaleFacts} /> : null}

      <MaterialWindows
        workflow={workflow}
        selections={selections}
        onAdd={addFiles}
        onRemove={removeSelection}
      />

      <Button type="submit" className="h-12 w-full text-base">
        Publish now
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your upload publishes immediately. Missing information never blocks publication.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Upload windows — the Owner states the purpose by choosing where to upload
// ---------------------------------------------------------------------------

/**
 * The whole material section.
 *
 * The workflow decides which windows lead; it never decides which materials
 * exist. Everything not in the leading set stays one disclosure away in the
 * same form, so an Owner who happens to have a floor plan during a price
 * update is never told to come back through a different workflow.
 */
function MaterialWindows(props: {
  workflow: StudioWorkflow;
  selections: MaterialSelection[];
  onAdd: (files: FileList | null, purpose: StudioMaterialPurpose) => void;
  onRemove: (key: string) => void;
}) {
  const primary = primaryMaterialWindows(props.workflow);
  const additional = additionalMaterialWindows(props.workflow);
  const groups = STUDIO_MATERIAL_GROUPS.filter((group) =>
    primary.some((window) => window.group === group),
  );
  // How many already-chosen files currently sit inside the collapsed group.
  const additionalPurposes = new Set(additional.map((window) => window.purpose));
  const hiddenSelected = props.selections.filter((selection) =>
    additionalPurposes.has(selection.purpose),
  ).length;
  return (
    <section className="space-y-4" aria-labelledby="studio-materials-heading">
      <div className="space-y-1">
        <h2 id="studio-materials-heading" className="text-sm font-medium leading-none">
          Materials
        </h2>
        <p className="text-xs text-muted-foreground">
          Upload each file into the window that says what it is. Every window is optional — upload
          what exists now and add the rest whenever you have it.
        </p>
      </div>

      {groups.map((group) => (
        <MaterialGroupSection
          key={group}
          group={group}
          windows={primary.filter((window) => window.group === group)}
          selections={props.selections}
          onAdd={props.onAdd}
          onRemove={props.onRemove}
        />
      ))}

      {additional.length ? (
        <details className="rounded-lg border border-border/40 p-3" open={hiddenSelected > 0}>
          {/*
            Files can end up in here without ever being hidden from the Owner:
            changing workflow keeps every selection (nothing is lost or
            relabelled) but moves the less usual windows into this disclosure.
            The count states, on the closed summary, that material is inside —
            and the group opens itself when it holds any — so "everything can be
            reviewed before Publish now" needs no hunting. It is an INDICATOR,
            never a step: it asks for nothing and blocks nothing.
          */}
          <summary className="cursor-pointer text-sm font-medium">
            More material types
            {hiddenSelected > 0 ? (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {hiddenSelected} file{hiddenSelected === 1 ? "" : "s"} selected
              </span>
            ) : null}
          </summary>
          <p className="mt-1 text-xs text-muted-foreground">
            Less usual for this workflow, but always available.
          </p>
          <div className="mt-3 space-y-4">
            {STUDIO_MATERIAL_GROUPS.filter((group) =>
              additional.some((window) => window.group === group),
            ).map((group) => (
              <MaterialGroupSection
                key={group}
                group={group}
                windows={additional.filter((window) => window.group === group)}
                selections={props.selections}
                onAdd={props.onAdd}
                onRemove={props.onRemove}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function MaterialGroupSection(props: {
  group: StudioMaterialGroup;
  windows: StudioMaterialWindow[];
  selections: MaterialSelection[];
  onAdd: (files: FileList | null, purpose: StudioMaterialPurpose) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {props.group}
      </h3>
      {/* One column at 375 px, two from `sm`: compact cards, never a wall. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {props.windows.map((window) => (
          <MaterialWindowCard
            key={window.purpose}
            window={window}
            selections={props.selections.filter(
              (selection) => selection.purpose === window.purpose,
            )}
            onAdd={props.onAdd}
            onRemove={props.onRemove}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One upload window.
 *
 * The picker is a real `<input type="file">` labelled by the window's own
 * heading, so its accessible name states the purpose and assistive technology
 * reads "Brochure", not "Choose file". It is `sr-only` rather than `hidden`:
 * still focusable, still keyboard-operable, with the visible control showing
 * the focus ring via `peer-focus-visible`.
 */
function MaterialWindowCard(props: {
  window: StudioMaterialWindow;
  selections: MaterialSelection[];
  onAdd: (files: FileList | null, purpose: StudioMaterialPurpose) => void;
  onRemove: (key: string) => void;
}) {
  const { window } = props;
  const inputId = `studio-material-${window.purpose}`;
  const cameraId = `studio-material-camera-${window.purpose}`;
  const hintId = `${inputId}-hint`;
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border/40 p-3">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={inputId} className="block">
          {window.label}
        </Label>
        <p id={hintId} className="text-xs text-muted-foreground">
          {window.hint}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="file"
          multiple
          accept={window.accept}
          aria-describedby={hintId}
          className="peer sr-only"
          onChange={(event) => {
            props.onAdd(event.target.files, window.purpose);
            // Clearing lets the SAME file be re-added after a removal.
            event.target.value = "";
          }}
        />
        <label
          htmlFor={inputId}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground peer-focus-visible:outline-none peer-focus-visible:ring-1 peer-focus-visible:ring-ring"
        >
          Choose files
        </label>
        {window.camera ? (
          <>
            <input
              id={cameraId}
              type="file"
              accept="image/*"
              capture="environment"
              // Named for the window, so "Take photo" is never ambiguous
              // between the two camera windows.
              aria-label={`Take a photo for ${window.label}`}
              aria-describedby={hintId}
              className="peer/camera sr-only"
              onChange={(event) => {
                props.onAdd(event.target.files, window.purpose);
                event.target.value = "";
              }}
            />
            <label
              htmlFor={cameraId}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground peer-focus-visible/camera:outline-none peer-focus-visible/camera:ring-1 peer-focus-visible/camera:ring-ring"
              aria-hidden="true"
            >
              Take photo
            </label>
          </>
        ) : null}
      </div>

      {props.selections.length ? (
        <ul className="space-y-1 text-sm" aria-label={`${window.label} files`}>
          {props.selections.map((selection) => (
            <li
              key={selection.key}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border/40 py-0.5 pl-2 pr-1"
            >
              <span className="min-w-0 flex-1 truncate">{selection.file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {(selection.file.size / (1024 * 1024)).toFixed(1)} MB
              </span>
              {/*
                Comfortable 44x44 CSS-pixel touch target for a phone-first flow,
                built from padding rather than from a bigger-looking control: the
                visible text stays the same small underlined "Remove".
              */}
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded px-2 text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => props.onRemove(selection.key)}
              >
                <span aria-hidden="true">Remove</span>
                <span className="sr-only">{`Remove ${selection.file.name} from ${window.label}`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusPanel(props: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="text-sm text-muted-foreground">{props.body}</p>
    </div>
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArchiveUploadPanel(props: {
  phase: {
    archiveIndex: number;
    archiveCount: number;
    fileName: string;
    progress: ArchiveUploadProgress;
  };
}) {
  const { archiveIndex, archiveCount, fileName, progress } = props.phase;
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100))
      : 0;
  const stateLabel =
    progress.state === "retrying"
      ? "Connection hiccup — retrying this part…"
      : progress.state === "paused"
        ? "Connection lost — upload paused. It resumes automatically when you are back online; the parts already uploaded are kept."
        : progress.state === "confirming"
          ? "Confirming stored parts on the server…"
          : progress.state === "stored"
            ? "Upload safely stored. Integrity verification continues."
            : progress.state === "preparing"
              ? "Preparing the upload…"
              : "Uploading…";
  return (
    <div className="mx-auto max-w-md space-y-4 py-14 text-center">
      <h2 className="text-lg font-semibold">
        Uploading archive {archiveIndex + 1} of {archiveCount}
      </h2>
      <p className="truncate text-sm text-muted-foreground">{fileName}</p>
      <Progress value={percent} />
      <p className="text-sm text-muted-foreground">
        {percent}% · {megabytes(progress.uploadedBytes)} of {megabytes(progress.totalBytes)} · part{" "}
        {Math.min(progress.partsDone + 1, progress.partCount)}/{progress.partCount}
      </p>
      <p className="text-xs text-muted-foreground">{stateLabel}</p>
      <p className="text-xs text-muted-foreground">
        Keep this page open while uploading. Interrupted parts retry on their own, and a retried
        upload resumes from the parts already stored — nothing restarts from zero.
      </p>
    </div>
  );
}

/**
 * Truthful per-archive status line. "Verified" appears ONLY at byte_verified
 * or later — storage acceptance alone is described as stored, never verified.
 */
function archiveStatusLine(archive: StudioJobProgress["archives"][number]): string {
  switch (archive.status) {
    case "rejected":
      return "kept private";
    case "completed":
      return "done — byte verification passed";
    case "processing_entries":
      return archive.entryCount != null
        ? `processing ${archive.entriesProcessed}/${archive.entryCount}`
        : "reading entries…";
    case "byte_verified":
      return "Archive byte verification passed.";
    case "byte_verifying":
    case "uploaded_unverified":
      return `verifying stored bytes ${archive.verifiedParts}/${archive.partCount} parts`;
    default:
      return `uploading parts ${archive.uploadedParts}/${archive.partCount}`;
  }
}

function ArchiveProcessingPanel(props: { progress: StudioJobProgress | null }) {
  const { progress } = props;
  const percent =
    progress && progress.discovered > 0
      ? Math.round((progress.processed / progress.discovered) * 100)
      : null;
  const allByteVerified =
    !!progress &&
    progress.archives.length > 0 &&
    progress.archives.every(
      (archive) =>
        archive.status === "byte_verified" ||
        archive.status === "processing_entries" ||
        archive.status === "completed",
    );
  return (
    <div className="mx-auto max-w-md space-y-4 py-14 text-center">
      <h2 className="text-lg font-semibold">Processing your archives…</h2>
      <p className="rounded-lg border border-border/40 bg-muted/30 p-3 text-sm">
        Upload safely stored. Integrity verification continues. You may close this page — Forever
        continues processing automatically in the background and on the Studio dashboard.
      </p>
      {allByteVerified ? (
        <p className="text-sm text-muted-foreground">Archive byte verification passed.</p>
      ) : null}
      {progress ? (
        <div className="space-y-3 text-left">
          {percent !== null ? <Progress value={percent} /> : null}
          <p className="text-center text-sm text-muted-foreground">
            {progress.discovered > 0
              ? `${progress.discovered} entries discovered · ${progress.processed} processed`
              : "Verifying stored bytes and reading archives…"}
          </p>
          <ul className="space-y-1 text-sm">
            {progress.archives.map((archive) => (
              <li
                key={archive.archiveId}
                className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
              >
                <span>{archive.label}</span>
                <span className="text-xs text-muted-foreground">{archiveStatusLine(archive)}</span>
              </li>
            ))}
          </ul>
          {progress.published + progress.retained + progress.skippedDuplicates > 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              {progress.published} public · {progress.retained} kept private ·{" "}
              {progress.skippedDuplicates} duplicates skipped
              {progress.failed ? ` · ${progress.failed} failed` : ""}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Working…</p>
      )}
    </div>
  );
}

function ResultPanel(props: { result: StudioJobResult; failedUploads: string[] }) {
  const { result } = props;
  const pageUrl =
    result.pagePath && typeof window !== "undefined"
      ? new URL(result.pagePath, window.location.origin).toString()
      : null;
  const share = async () => {
    if (!pageUrl) return;
    if (navigator.share) {
      await navigator.share({ url: pageUrl }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(pageUrl);
    }
  };
  return (
    <div className="mx-auto max-w-md space-y-5 py-10">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Published</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The page is live now. Anything missing can be added later.
        </p>
      </div>
      {result.counts ? (
        <p className="text-center text-sm text-muted-foreground">
          {result.counts.units} units · {result.counts.prices} prices · {result.counts.media} media
          {result.counts.warnings ? ` · ${result.counts.warnings} notes` : ""}
        </p>
      ) : null}
      {props.failedUploads.length ? (
        <p className="text-center text-sm text-destructive">
          {props.failedUploads.length} file(s) failed to upload and were skipped:{" "}
          {props.failedUploads.join(", ")}. Upload them again any time.
        </p>
      ) : null}
      {result.warnings.length ? (
        <details className="rounded-lg border border-border/40 p-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {result.warnings.length} note(s) for later enrichment
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {result.warnings.slice(0, 20).map((warning, index) => (
              <li key={index}>{warning.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="grid gap-2">
        {result.pagePath ? (
          <Button asChild className="h-12 text-base">
            <a href={result.pagePath} target="_blank" rel="noreferrer">
              Open page
            </a>
          </Button>
        ) : null}
        {pageUrl ? (
          <Button variant="outline" onClick={() => void share()}>
            Share
          </Button>
        ) : null}
        {result.projectSlug ? (
          <Button asChild variant="outline">
            <Link to="/studio/project/$slug" params={{ slug: result.projectSlug }}>
              Edit details
            </Link>
          </Button>
        ) : null}
        {result.listingId ? (
          <Button asChild variant="outline">
            <Link to="/studio/resale/$id" params={{ id: result.listingId }}>
              Edit listing
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link to="/studio">Back to Studio</Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TextField(props: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        required={props.required}
        placeholder={props.placeholder}
        value={props.value ?? ""}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

function ProjectFactsFields(props: {
  facts: StudioProjectFacts;
  onChange: (facts: StudioProjectFacts) => void;
}) {
  const set = (patch: Partial<StudioProjectFacts>) => props.onChange({ ...props.facts, ...patch });
  return (
    <div className="space-y-4">
      <TextField
        id="pf-name"
        label="Project name (optional)"
        value={props.facts.name}
        onChange={(name) => set({ name })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="pf-developer"
          label="Developer (optional)"
          value={props.facts.developerName}
          onChange={(developerName) => set({ developerName })}
        />
        <TextField
          id="pf-location"
          label="Location (optional)"
          placeholder="e.g. Kamala, Phuket"
          value={props.facts.locationText}
          onChange={(locationText) => set({ locationText })}
        />
        <TextField
          id="pf-type"
          label="Project type (optional)"
          placeholder="e.g. Condominium"
          value={props.facts.projectType}
          onChange={(projectType) => set({ projectType })}
        />
        <TextField
          id="pf-price"
          label="Starting price THB (optional)"
          type="number"
          value={props.facts.startingPriceThb?.toString()}
          onChange={(value) => set({ startingPriceThb: value ? Number(value) : undefined })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-short">Short description (optional)</Label>
        <Textarea
          id="pf-short"
          rows={3}
          value={props.facts.shortDescription ?? ""}
          onChange={(event) => set({ shortDescription: event.target.value })}
        />
      </div>
    </div>
  );
}

function ResaleFactsFields(props: {
  facts: StudioResaleFacts;
  onChange: (facts: StudioResaleFacts) => void;
}) {
  const set = (patch: Partial<StudioResaleFacts>) => props.onChange({ ...props.facts, ...patch });
  const number = (value: string) => (value ? Number(value) : undefined);
  return (
    <div className="space-y-4">
      <TextField
        id="rf-title"
        label="Listing title"
        placeholder="e.g. 2-bedroom sea-view condo, Kamala"
        value={props.facts.title}
        onChange={(title) => set({ title })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="rf-project"
          label="Project (optional)"
          value={props.facts.projectName}
          onChange={(projectName) => set({ projectName })}
        />
        <TextField
          id="rf-location"
          label="Location (optional)"
          value={props.facts.locationText}
          onChange={(locationText) => set({ locationText })}
        />
        <TextField
          id="rf-price"
          label="Price (optional)"
          type="number"
          value={props.facts.price?.toString()}
          onChange={(value) => set({ price: number(value) })}
        />
        <TextField
          id="rf-currency"
          label="Currency (optional)"
          placeholder="THB"
          value={props.facts.currency}
          onChange={(currency) => set({ currency })}
        />
        <TextField
          id="rf-bedrooms"
          label="Bedrooms (optional)"
          type="number"
          value={props.facts.bedrooms?.toString()}
          onChange={(value) => set({ bedrooms: number(value) })}
        />
        <TextField
          id="rf-bathrooms"
          label="Bathrooms (optional)"
          type="number"
          value={props.facts.bathrooms?.toString()}
          onChange={(value) => set({ bathrooms: number(value) })}
        />
        <TextField
          id="rf-area"
          label="Area m² (optional)"
          type="number"
          value={props.facts.areaSqm?.toString()}
          onChange={(value) => set({ areaSqm: number(value) })}
        />
        <TextField
          id="rf-contact"
          label="Contact phone (optional)"
          value={props.facts.contactPhone}
          onChange={(contactPhone) => set({ contactPhone })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rf-description">Description (optional)</Label>
        <Textarea
          id="rf-description"
          rows={4}
          value={props.facts.description ?? ""}
          onChange={(event) => set({ description: event.target.value })}
        />
      </div>
    </div>
  );
}
