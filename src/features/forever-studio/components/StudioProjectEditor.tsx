/**
 * Quick facts editor for one project: fill blanks or correct fields after
 * publication. Saves through the same precedence-aware enrichment lane as
 * uploads, so an Owner-verified value is never silently overwritten.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  studioGetOverview,
  studioSaveProjectFacts,
  studioSetProjectPublication,
} from "../studio.functions";
import { projectPagePath, type StudioProjectFacts } from "../studio-types";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";

export function StudioProjectEditor(props: { slug: string }) {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: STUDIO_OVERVIEW_KEY,
    queryFn: () => studioGetOverview(),
    retry: false,
  });
  const [facts, setFacts] = useState<StudioProjectFacts>({});
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => studioSaveProjectFacts({ data: { slug: props.slug, facts } }),
    onSuccess: (result) => {
      setMessage(
        result.warnings.length
          ? `Saved. ${result.warnings.length} field(s) kept their existing verified value.`
          : "Saved.",
      );
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Save failed."),
  });
  const publication = useMutation({
    mutationFn: (publish: boolean) =>
      studioSetProjectPublication({ data: { slug: props.slug, publish } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
  });

  const project = overview.data?.projects.find((item) => item.slug === props.slug);
  const set = (patch: Partial<StudioProjectFacts>) => setFacts({ ...facts, ...patch });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{project?.name ?? props.slug}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {project ? `Status: ${project.publicStatus}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={projectPagePath(props.slug)} target="_blank" rel="noreferrer">
            Open page
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/studio/upload" search={{ workflow: "project_update", slug: props.slug }}>
            Upload update
          </Link>
        </Button>
        {project ? (
          <Button
            variant="outline"
            size="sm"
            disabled={publication.isPending}
            onClick={() => publication.mutate(project.publicStatus !== "published")}
          >
            {project.publicStatus === "published" ? "Unpublish" : "Publish"}
          </Button>
        ) : null}
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Enter only the fields you want to add or correct — everything else stays untouched.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="edit-developer"
            label="Developer"
            onChange={(v) => set({ developerName: v })}
          />
          <Field id="edit-location" label="Location" onChange={(v) => set({ locationText: v })} />
          <Field id="edit-type" label="Project type" onChange={(v) => set({ projectType: v })} />
          <Field
            id="edit-price"
            label="Starting price THB"
            type="number"
            onChange={(v) => set({ startingPriceThb: v ? Number(v) : undefined })}
          />
          <Field
            id="edit-status"
            label="Construction status"
            onChange={(v) => set({ constructionStatus: v })}
          />
          <Field
            id="edit-completion"
            label="Completion date (YYYY-MM-DD)"
            onChange={(v) => set({ completionDate: v })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-short">Short description</Label>
          <Textarea
            id="edit-short"
            rows={3}
            onChange={(event) => set({ shortDescription: event.target.value || undefined })}
          />
        </div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </form>
    </div>
  );
}

function Field(props: {
  id: string;
  label: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}
