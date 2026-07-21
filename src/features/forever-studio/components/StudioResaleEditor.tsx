/**
 * Quick editor for one resale listing: correct facts, publish or unpublish.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  studioGetOverview,
  studioSetListingPublication,
  studioUpdateResale,
} from "../studio.functions";
import { resalePagePath, type StudioResaleFacts } from "../studio-types";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";

export function StudioResaleEditor(props: { listingId: string }) {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: STUDIO_OVERVIEW_KEY,
    queryFn: () => studioGetOverview(),
    retry: false,
  });
  const [facts, setFacts] = useState<StudioResaleFacts>({});
  const [message, setMessage] = useState<string | null>(null);

  const listing = overview.data?.listings.find((item) => item.id === props.listingId);

  const save = useMutation({
    mutationFn: () => studioUpdateResale({ data: { listingId: props.listingId, facts } }),
    onSuccess: () => {
      setMessage("Saved.");
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Save failed."),
  });
  const publication = useMutation({
    mutationFn: (publish: boolean) =>
      studioSetListingPublication({ data: { listingId: props.listingId, publish } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
  });

  const set = (patch: Partial<StudioResaleFacts>) => setFacts({ ...facts, ...patch });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{listing?.title ?? "Resale listing"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {listing ? `Status: ${listing.publicationStatus}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {listing?.slug ? (
          <Button asChild variant="outline" size="sm">
            <a href={resalePagePath(listing.slug)} target="_blank" rel="noreferrer">
              Open page
            </a>
          </Button>
        ) : null}
        {listing ? (
          <Button
            variant="outline"
            size="sm"
            disabled={publication.isPending}
            onClick={() => publication.mutate(listing.publicationStatus !== "published")}
          >
            {listing.publicationStatus === "published" ? "Unpublish" : "Publish"}
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
        <p className="text-sm text-muted-foreground">Enter only the fields you want to change.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rl-title" label="Title" onChange={(v) => set({ title: v || undefined })} />
          <Field
            id="rl-price"
            label="Price"
            type="number"
            onChange={(v) => set({ price: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-currency"
            label="Currency"
            onChange={(v) => set({ currency: v || undefined })}
          />
          <Field
            id="rl-bedrooms"
            label="Bedrooms"
            type="number"
            onChange={(v) => set({ bedrooms: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-bathrooms"
            label="Bathrooms"
            type="number"
            onChange={(v) => set({ bathrooms: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-area"
            label="Area m²"
            type="number"
            onChange={(v) => set({ areaSqm: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-location"
            label="Location"
            onChange={(v) => set({ locationText: v || undefined })}
          />
          <Field
            id="rl-contact"
            label="Contact phone"
            onChange={(v) => set({ contactPhone: v || undefined })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rl-description">Description</Label>
          <Textarea
            id="rl-description"
            rows={4}
            onChange={(event) => set({ description: event.target.value || undefined })}
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
