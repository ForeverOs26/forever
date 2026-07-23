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
  LARGE_ARCHIVE_MAX_BYTES,
  STUDIO_WORKFLOW_LABELS,
  STUDIO_WORKFLOWS,
  type StudioJobProgress,
  type StudioJobResult,
  type StudioProjectFacts,
  type StudioResaleFacts,
  type StudioWorkflow,
} from "../studio-types";
import {
  archiveTooLarge,
  isLargeArchive,
  uploadLargeArchive,
  type ArchiveUploadProgress,
} from "./archive-upload";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";
import { StudioRouteDenied } from "./StudioRouteDenied";

const FILE_ACCEPT = "image/*,video/*,.pdf,.zip,.json,.csv,.xls,.xlsx,.doc,.docx,.txt,.heic,.webp";

/** Continuation cadence while the page stays open on a sliced job. */
const PROCESS_POLL_MS = 3000;

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
  | { step: "error"; message: string; jobId: string | null };

export function StudioUploader(props: { workflow?: StudioWorkflow; slug?: string }) {
  const queryClient = useQueryClient();
  const [workflow, setWorkflow] = useState<StudioWorkflow>(props.workflow ?? "new_development");
  const [projectSlug, setProjectSlug] = useState(props.slug ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [projectFacts, setProjectFacts] = useState<StudioProjectFacts>({});
  const [resaleFacts, setResaleFacts] = useState<StudioResaleFacts>({});
  const filePickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
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
    return <StudioRouteDenied />;
  }

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFiles((current) => [...current, ...Array.from(incoming)]);
  };

  const runJob = async (jobId?: string) => {
    let id = jobId ?? null;
    try {
      const failedUploads: string[] = [];
      const largeArchives = files.filter(isLargeArchive);
      const ordinary = files.filter((file) => !isLargeArchive(file));
      const oversized = largeArchives.find(archiveTooLarge);
      if (!id && oversized) {
        setPhase({
          step: "error",
          message: `${oversized.name} is larger than ${Math.round(LARGE_ARCHIVE_MAX_BYTES / (1024 * 1024))} MB. Split the archive and try again.`,
          jobId: null,
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
            files: ordinary.map((file) => ({
              name: file.name,
              size: file.size,
              contentType: file.type || undefined,
            })),
          },
        });
        id = started.jobId;
        setPhase({ step: "uploading", done: 0, total: started.uploads.length });
        for (let index = 0; index < started.uploads.length; index += 1) {
          const target = started.uploads[index];
          const file = ordinary[index];
          if (!file) continue;
          const { error } = await supabase.storage
            .from(target.bucket)
            .uploadToSignedUrl(target.path, target.token, file, {
              contentType: file.type || undefined,
            });
          if (error) failedUploads.push(target.name);
          setPhase({ step: "uploading", done: index + 1, total: started.uploads.length });
        }
        // Large archives: resumable chunked upload, one archive at a time.
        // Each part retries on its own; re-running resumes the stored parts.
        for (let index = 0; index < largeArchives.length; index += 1) {
          const file = largeArchives[index];
          await uploadLargeArchive(id, file, (progress) => {
            if (!alive.current) return;
            setPhase({
              step: "uploadingArchive",
              archiveIndex: index,
              archiveCount: largeArchives.length,
              fileName: file.name,
              progress,
            });
          });
        }
      }
      setPhase({ step: "processing" });
      let result = await studioProcessJob({ data: { jobId: id } });
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
      // Sliced continuation: while this page stays open it keeps driving the
      // job; after it closes, any Studio session's dashboard poll (or a
      // scheduled caller) resumes the durable work automatically.
      while (result.status === "processing" && alive.current) {
        setPhase({ step: "archiveProcessing", jobId: id, progress: result.progress ?? null });
        await new Promise((resolve) => setTimeout(resolve, PROCESS_POLL_MS));
        if (!alive.current) return;
        result = await studioProcessJob({ data: { jobId: id } });
      }
      if (!alive.current) return;
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
      if (result.status === "failed") {
        setPhase({ step: "error", message: result.error ?? "Processing failed.", jobId: id });
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
          Uploaded files remain private. Retry to confirm processing; a job that never reaches that
          boundary will not publish automatically.
        </p>
        <div className="flex justify-center gap-2">
          {phase.jobId ? (
            <Button onClick={() => void runJob(phase.jobId!)}>Retry processing</Button>
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

      <div className="space-y-2">
        <Label>Materials</Label>
        <p className="text-xs text-muted-foreground">
          PDFs, brochures, price lists, plans, ZIP archives, photos, and videos. Everything is
          optional — upload what exists now and add the rest later.
        </p>
        <input
          ref={filePickerRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => filePickerRef.current?.click()}>
            Choose files
          </Button>
          <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}>
            Take photo
          </Button>
        </div>
        {files.length ? (
          <ul className="space-y-1 text-sm">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2"
              >
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

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
      : progress.state === "verifying"
        ? "Verifying stored parts on the server…"
        : progress.state === "accepted"
          ? "Accepted"
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

function ArchiveProcessingPanel(props: { progress: StudioJobProgress | null }) {
  const { progress } = props;
  const percent =
    progress && progress.discovered > 0
      ? Math.round((progress.processed / progress.discovered) * 100)
      : null;
  return (
    <div className="mx-auto max-w-md space-y-4 py-14 text-center">
      <h2 className="text-lg font-semibold">Processing your archives…</h2>
      <p className="rounded-lg border border-border/40 bg-muted/30 p-3 text-sm">
        You may close this page. Uploading is complete and verified; Forever continues processing
        and resumes automatically — check the Studio dashboard any time.
      </p>
      {progress ? (
        <div className="space-y-3 text-left">
          {percent !== null ? <Progress value={percent} /> : null}
          <p className="text-center text-sm text-muted-foreground">
            {progress.discovered > 0
              ? `${progress.processed} of ${progress.discovered} files processed`
              : "Verifying and reading archives…"}
          </p>
          <ul className="space-y-1 text-sm">
            {progress.archives.map((archive) => (
              <li
                key={archive.archiveId}
                className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
              >
                <span>{archive.label}</span>
                <span className="text-xs text-muted-foreground">
                  {archive.status === "rejected"
                    ? "kept private"
                    : archive.status === "completed"
                      ? "done"
                      : archive.entryCount != null
                        ? `${archive.entriesProcessed}/${archive.entryCount}`
                        : `verifying ${archive.verifiedParts}/${archive.partCount}`}
                </span>
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
