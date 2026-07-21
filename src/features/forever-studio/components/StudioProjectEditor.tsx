/**
 * Project editor: prefilled with the current values, shows which are public,
 * lets the Owner pick the hero image, and corrects fields after publication.
 * Saves through the precedence-aware enrichment lane, so an Owner-provided
 * value is never silently overwritten by a lower-precedence source.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  studioGetProjectDetail,
  studioSaveProjectFacts,
  studioSetHeroImage,
  studioSetProjectPublication,
} from "../studio.functions";
import { projectPagePath, type StudioProjectFacts } from "../studio-types";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";

export function StudioProjectEditor(props: { slug: string }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["studio", "project", props.slug],
    queryFn: () => studioGetProjectDetail({ data: { slug: props.slug } }),
    retry: false,
  });
  const [facts, setFacts] = useState<StudioProjectFacts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const detail = detailQuery.data;

  useEffect(() => {
    if (detail && facts === null) setFacts({ ...detail.facts });
  }, [detail, facts]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["studio", "project", props.slug] });
    void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
  };

  const save = useMutation({
    mutationFn: () => studioSaveProjectFacts({ data: { slug: props.slug, facts: facts ?? {} } }),
    onSuccess: (result) => {
      setMessage(
        result.warnings.length
          ? `Saved. ${result.warnings.length} field(s) kept their existing higher-precedence value.`
          : "Saved.",
      );
      invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Save failed."),
  });
  const publication = useMutation({
    mutationFn: (publish: boolean) =>
      studioSetProjectPublication({ data: { slug: props.slug, publish } }),
    onSettled: invalidate,
  });
  const hero = useMutation({
    mutationFn: (url: string) => studioSetHeroImage({ data: { slug: props.slug, url } }),
    onSettled: invalidate,
  });

  if (detailQuery.isPending || facts === null) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (detailQuery.isError || !detail) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Project not found.</p>;
  }

  const set = (patch: Partial<StudioProjectFacts>) => setFacts({ ...facts, ...patch });
  const images = detail.media.filter((m) => m.mediaType === "gallery");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{detail.name}</h1>
          <Badge variant={detail.isPublic ? "default" : "secondary"}>
            {detail.isPublic ? "Public" : "Not public"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail.slug}
          {detail.lastSourceDate ? ` · source dated ${detail.lastSourceDate}` : ""}
          {detail.updatedAt ? ` · updated ${detail.updatedAt.slice(0, 10)}` : ""}
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
        <Button
          variant="outline"
          size="sm"
          disabled={publication.isPending}
          onClick={() => publication.mutate(!detail.isPublic)}
        >
          {detail.isPublic ? "Unpublish" : "Publish"}
        </Button>
      </div>

      {images.length ? (
        <section className="space-y-2">
          <Label>Hero image (shown at the top of the public page)</Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((image) => (
              <button
                key={image.url}
                type="button"
                onClick={() => hero.mutate(image.url)}
                disabled={hero.isPending}
                className={`relative overflow-hidden rounded-lg border ${
                  image.isHero ? "border-primary ring-2 ring-primary" : "border-border/60"
                }`}
              >
                <img
                  src={image.url}
                  alt={image.title ?? "project image"}
                  className="aspect-square w-full object-cover"
                />
                {image.isHero ? (
                  <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    Hero
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          These are the current values — edit any of them. Everything is optional; blank fields are
          left untouched.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="edit-name"
            label="Project name"
            value={facts.name}
            onChange={(v) => set({ name: v })}
          />
          <Field
            id="edit-developer"
            label="Developer"
            value={facts.developerName}
            onChange={(v) => set({ developerName: v })}
          />
          <Field
            id="edit-location"
            label="Location"
            value={facts.locationText}
            onChange={(v) => set({ locationText: v })}
          />
          <Field
            id="edit-type"
            label="Project type"
            value={facts.projectType}
            onChange={(v) => set({ projectType: v })}
          />
          <Field
            id="edit-price"
            label="Starting price THB"
            type="number"
            value={facts.startingPriceThb?.toString()}
            onChange={(v) => set({ startingPriceThb: v ? Number(v) : undefined })}
          />
          <Field
            id="edit-status"
            label="Construction status"
            value={facts.constructionStatus}
            onChange={(v) => set({ constructionStatus: v })}
          />
          <Field
            id="edit-completion"
            label="Completion date (YYYY-MM-DD)"
            value={facts.completionDate}
            onChange={(v) => set({ completionDate: v })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-short">Short description</Label>
          <Textarea
            id="edit-short"
            rows={3}
            value={facts.shortDescription ?? ""}
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
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value ?? ""}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}
