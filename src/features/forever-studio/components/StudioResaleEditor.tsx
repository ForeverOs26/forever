/**
 * Resale editor: prefilled with the current values (including the private
 * contact, which only Studio can see), publish/unpublish, and corrections.
 * Contact details are stored privately and never appear on the public page.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  studioGetListingDetail,
  studioSetListingPublication,
  studioUpdateResale,
} from "../studio.functions";
import { resalePagePath, type StudioResaleFacts } from "../studio-types";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";

export function StudioResaleEditor(props: { listingId: string }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["studio", "listing", props.listingId],
    queryFn: () => studioGetListingDetail({ data: { listingId: props.listingId } }),
    retry: false,
  });
  const [facts, setFacts] = useState<StudioResaleFacts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const detail = detailQuery.data;

  useEffect(() => {
    if (detail && facts === null) setFacts({ ...detail.facts });
  }, [detail, facts]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["studio", "listing", props.listingId] });
    void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
  };

  const save = useMutation({
    mutationFn: () =>
      studioUpdateResale({ data: { listingId: props.listingId, facts: facts ?? {} } }),
    onSuccess: () => {
      setMessage("Saved.");
      invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Save failed."),
  });
  const publication = useMutation({
    mutationFn: (publish: boolean) =>
      studioSetListingPublication({ data: { listingId: props.listingId, publish } }),
    onSettled: invalidate,
  });

  if (detailQuery.isPending || facts === null) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (detailQuery.isError || !detail) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Listing not found.</p>;
  }

  const set = (patch: Partial<StudioResaleFacts>) => setFacts({ ...facts, ...patch });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{facts.title ?? "Resale listing"}</h1>
          <Badge variant={detail.isPublic ? "default" : "secondary"}>
            {detail.isPublic ? "Public" : "Not public"}
          </Badge>
        </div>
        {detail.updatedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            updated {detail.updatedAt.slice(0, 10)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {detail.slug ? (
          <Button asChild variant="outline" size="sm">
            <a href={resalePagePath(detail.slug)} target="_blank" rel="noreferrer">
              Open page
            </a>
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={publication.isPending}
          onClick={() => publication.mutate(!detail.isPublic)}
        >
          {detail.isPublic ? "Unpublish" : "Publish"}
        </Button>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          These are the current values — edit any of them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="rl-title"
            label="Title"
            value={facts.title}
            onChange={(v) => set({ title: v || undefined })}
          />
          <Field
            id="rl-price"
            label="Price"
            type="number"
            value={facts.price?.toString()}
            onChange={(v) => set({ price: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-currency"
            label="Currency"
            value={facts.currency}
            onChange={(v) => set({ currency: v || undefined })}
          />
          <Field
            id="rl-bedrooms"
            label="Bedrooms"
            type="number"
            value={facts.bedrooms?.toString()}
            onChange={(v) => set({ bedrooms: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-bathrooms"
            label="Bathrooms"
            type="number"
            value={facts.bathrooms?.toString()}
            onChange={(v) => set({ bathrooms: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-area"
            label="Area m²"
            type="number"
            value={facts.areaSqm?.toString()}
            onChange={(v) => set({ areaSqm: v ? Number(v) : undefined })}
          />
          <Field
            id="rl-location"
            label="Location"
            value={facts.locationText}
            onChange={(v) => set({ locationText: v || undefined })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rl-description">Description</Label>
          <Textarea
            id="rl-description"
            rows={4}
            value={facts.description ?? ""}
            onChange={(event) => set({ description: event.target.value || undefined })}
          />
        </div>

        <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            Private seller contact — never shown on the public page
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="rl-contact-name"
              label="Contact name"
              value={facts.contactName}
              onChange={(v) => set({ contactName: v || undefined })}
            />
            <Field
              id="rl-contact-phone"
              label="Contact phone"
              value={facts.contactPhone}
              onChange={(v) => set({ contactPhone: v || undefined })}
            />
            <Field
              id="rl-contact-email"
              label="Contact email"
              value={facts.contactEmail}
              onChange={(v) => set({ contactEmail: v || undefined })}
            />
          </div>
        </fieldset>

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
