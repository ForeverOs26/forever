/**
 * Facilities & Amenities editor (FOREVER-STUDIO-AMENITIES-CORE-001).
 *
 * The Owner picks which canonical amenities a project has, writes the
 * project-specific note for each, chooses which few lead the public list, and
 * orders them. One Save reconciles the whole set in one transaction.
 *
 * Three properties this component exists to hold:
 *
 *   * The submitted set is the EXACT final set, never a diff. Saving an empty
 *     selection is a legitimate act — it means no amenities are shown on the
 *     public project page — so Save is never disabled for it. It is deliberately
 *     NOT a claim that the development physically has no amenities: an empty
 *     relation records that none have been entered, and the page says nothing
 *     rather than asserting an absence.
 *   * A failed save NEVER touches local state. The Owner's work is the only
 *     copy of it; re-reading the server on error would discard the very edits
 *     they were trying to keep. Only a successful save re-hydrates, and it
 *     re-hydrates from the transaction's canonical state rather than from the
 *     optimistic input, so what is on screen is what was committed.
 *   * A read failure degrades to one inline line. This section is a sibling of
 *     the project form; it must never be able to throw the whole editor route
 *     into a denial or error state on its own.
 *
 * Layout is a single vertical column of cards throughout — no tab strip, no
 * side-by-side panes — because the Owner uses this on a phone, standing in the
 * sales gallery.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  AMENITY_CATEGORY_ALL,
  AMENITY_SORT_STEP,
  catalogueCategories,
  closeMatches,
  displayOrder,
  featuredCount,
  featuredLimitReached,
  filterCatalogue,
  normalizeSortOrders,
  reorder,
  suggestAmenitySlug,
  toSavePayload,
} from "../amenity-editor-state";
import { studioGetProjectAmenities, studioSaveProjectAmenities } from "../studio.functions";
import {
  isStudioAmenityCategory,
  STUDIO_AMENITY_CATEGORIES,
  STUDIO_MAX_FEATURED_AMENITIES,
  type StudioAmenityCatalogueEntry,
  type StudioCreatedAmenity,
  type StudioProjectAmenity,
} from "../studio-types";

/** Kebab-case, matching what the migration accepts for a new amenity slug. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EMPTY_DRAFT = { name: "", slug: "", category: "", icon: "" };

/**
 * The comparison used for the unsaved-changes indicator: the exact set that
 * would be sent, plus whatever creations are staged. Comparing the save payload
 * rather than the raw state means a change the save would not carry — a
 * re-render, a reordered no-op — never reads as dirty.
 */
function projection(selected: StudioProjectAmenity[], created: StudioCreatedAmenity[]): string {
  return JSON.stringify({ amenities: toSavePayload(selected), created });
}

function toEditable(row: {
  slug: string;
  name: string;
  category: string;
  icon: string;
  note: string;
  isFeatured: boolean;
  sortOrder: number;
}): StudioProjectAmenity {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    icon: row.icon,
    note: row.note,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
  };
}

export function StudioProjectAmenitiesEditor(props: { slug: string }) {
  const queryClient = useQueryClient();
  const amenitiesQuery = useQuery({
    queryKey: ["studio", "project", props.slug, "amenities"],
    queryFn: () => studioGetProjectAmenities({ data: { slug: props.slug } }),
    retry: false,
  });

  const [selected, setSelected] = useState<StudioProjectAmenity[] | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [created, setCreated] = useState<StudioCreatedAmenity[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(AMENITY_CATEGORY_ALL);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [slugTouched, setSlugTouched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loaded = amenitiesQuery.data;

  // Hydrate once, like the project form's `facts === null` guard: a later
  // refetch (another section invalidating this project) must never overwrite
  // edits in progress.
  useEffect(() => {
    if (loaded && selected === null) {
      const rows = loaded.selected.map(toEditable);
      setSelected(rows);
      setBaseline(projection(rows, []));
    }
  }, [loaded, selected]);

  const save = useMutation({
    mutationFn: (payload: { selected: StudioProjectAmenity[]; created: StudioCreatedAmenity[] }) =>
      studioSaveProjectAmenities({
        data: {
          slug: props.slug,
          amenities: payload.selected.map((entry) => ({
            slug: entry.slug,
            note: entry.note,
            isFeatured: entry.isFeatured,
            sortOrder: entry.sortOrder,
          })),
          createdAmenities: payload.created,
        },
      }),
    onSuccess: (result) => {
      // The canonical committed state — trimmed notes, resolved slugs, public
      // order — replaces the optimistic local copy. Staged creations are now
      // real catalogue rows, so the staging list is empty again.
      const rows = result.selected.map(toEditable);
      setSelected(rows);
      setCreated([]);
      setBaseline(projection(rows, []));
      setMessage(
        result.createdAmenitySlugs.length
          ? `Saved. ${result.createdAmenitySlugs.length} new amenity added to the catalogue.`
          : "Saved.",
      );
      void queryClient.invalidateQueries({ queryKey: ["studio", "project", props.slug] });
    },
    // Deliberately no state reset here. See the file header.
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "Could not save amenities."),
  });

  // A read failure only takes over the section when there is nothing to take
  // over FROM. Once the editor has hydrated, the Owner may have unsaved edits on
  // screen, and a failed REFETCH must not replace them with an error line — the
  // work would still be in state but invisible, which reads as data loss.
  //
  // Refetches are not hypothetical: a successful save invalidates
  // `["studio", "project", slug]`, a prefix that matches this query, so every
  // save triggers one. With `retry: false` a single transient failure is enough.
  if (amenitiesQuery.isError && (!loaded || selected === null)) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Facilities &amp; Amenities</h2>
        <p className="text-sm text-muted-foreground">
          Amenities could not be loaded just now.{" "}
          <button type="button" className="underline" onClick={() => void amenitiesQuery.refetch()}>
            Try again
          </button>
        </p>
      </section>
    );
  }

  if (!loaded || selected === null) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Facilities &amp; Amenities</h2>
        <p className="text-sm text-muted-foreground">Loading amenities…</p>
      </section>
    );
  }

  const featured = featuredCount(selected);
  const atFeaturedLimit = featuredLimitReached(selected);
  const dirty = baseline !== null && projection(selected, created) !== baseline;

  // Staged creations are offered to the picker and to close-match detection as
  // if they were catalogue rows: they will be real rows the moment this saves,
  // and until then they must still be findable and still warn about a near
  // duplicate of themselves.
  const stagedEntries: StudioAmenityCatalogueEntry[] = created.map((entry) => ({
    id: `staged:${entry.slug}`,
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    icon: entry.icon,
  }));
  const catalogue = [...loaded.catalogue, ...stagedEntries];
  const categories = catalogueCategories(catalogue);
  const selectedSlugs = new Set(selected.map((entry) => entry.slug));
  const available = filterCatalogue(catalogue, { search, category }).filter(
    (entry) => !selectedSlugs.has(entry.slug),
  );
  const draftMatches = closeMatches(catalogue, { name: draft.name, slug: draft.slug });

  const add = (entry: StudioAmenityCatalogueEntry) => {
    setMessage(null);
    setSelected(
      normalizeSortOrders([
        ...selected,
        {
          slug: entry.slug,
          name: entry.name,
          category: entry.category,
          icon: entry.icon,
          note: "",
          // A newly added amenity is never featured by default: leading the
          // public list is an explicit editorial choice.
          isFeatured: false,
          sortOrder: 0,
        },
      ]),
    );
  };

  const remove = (slug: string) => {
    setMessage(null);
    setSelected(normalizeSortOrders(selected.filter((entry) => entry.slug !== slug)));
    // Backing out of a selection also un-stages its creation: the Owner has
    // withdrawn it, and the save must not add a catalogue row nothing uses.
    setCreated(created.filter((entry) => entry.slug !== slug));
  };

  const setNote = (slug: string, note: string) => {
    setSelected(selected.map((entry) => (entry.slug === slug ? { ...entry, note } : entry)));
  };

  const setFeatured = (slug: string, isFeatured: boolean) => {
    setMessage(null);
    // The moved row is pushed past every current position so it lands at the
    // END of the group it is joining, then the whole list is re-sorted into
    // public order and renumbered. The list on screen therefore always reads in
    // the order the page will render.
    const moved = selected.map((entry) =>
      entry.slug === slug
        ? { ...entry, isFeatured, sortOrder: (selected.length + 1) * AMENITY_SORT_STEP }
        : entry,
    );
    setSelected(normalizeSortOrders(displayOrder(moved)));
  };

  const move = (slug: string, direction: "up" | "down") => {
    setSelected(reorder(selected, slug, direction));
  };

  /**
   * Whether a move would actually do anything: reordering happens within the
   * featured/non-featured group, so a row with no same-group neighbour in that
   * direction is at a boundary. Disabling the control there is what stops the
   * editor from offering a button that silently does nothing.
   */
  const canMove = (index: number, step: -1 | 1) => {
    const group = selected[index].isFeatured;
    for (let at = index + step; at >= 0 && at < selected.length; at += step) {
      if (selected[at].isFeatured === group) return true;
    }
    return false;
  };

  const stageCreated = () => {
    const name = draft.name.trim();
    const slug = draft.slug.trim();
    if (!name || !slug) {
      setMessage("A new amenity needs both a name and an identifier.");
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setMessage("An identifier must be lower-case words joined by single hyphens.");
      return;
    }
    if (catalogue.some((entry) => entry.slug === slug)) {
      setMessage(`The identifier ${slug} already exists — select it above instead.`);
      return;
    }
    // Category is required, and the selector below only offers supported values —
    // so this catches the "not chosen yet" case rather than a bad value. The
    // server and the save function re-check it either way.
    if (!isStudioAmenityCategory(draft.category.trim())) {
      setMessage("Choose a category for the new amenity.");
      return;
    }
    const entry: StudioCreatedAmenity = {
      name,
      slug,
      category: draft.category.trim(),
      // Icon stays optional: a blank one renders as the neutral marker and
      // blocks neither the save nor the project's publication.
      icon: draft.icon.trim(),
    };
    setCreated([...created, entry]);
    setSelected(
      normalizeSortOrders([...selected, { ...entry, note: "", isFeatured: false, sortOrder: 0 }]),
    );
    setDraft(EMPTY_DRAFT);
    setSlugTouched(false);
    setMessage(null);
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Facilities &amp; Amenities</h2>
        <p className="text-sm text-muted-foreground">
          Exactly this list appears on the public page. Featured amenities lead it.
        </p>
        <p className="text-sm font-medium" data-testid="amenity-counts">
          {selected.length} selected · {featured} / {STUDIO_MAX_FEATURED_AMENITIES} featured
        </p>
        {dirty ? (
          <p className="text-sm text-amber-700 dark:text-amber-500">Unsaved changes</p>
        ) : null}
        {amenitiesQuery.isError ? (
          // The editor is already hydrated, so this is a failed refresh, not a
          // failed load. Say so alongside the list rather than in place of it:
          // what is on screen is still the Owner's own work, and it is still
          // saveable.
          <p className="text-sm text-amber-700 dark:text-amber-500" data-testid="amenity-stale">
            Could not refresh from the server. What you see here is your own unsaved copy.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void amenitiesQuery.refetch()}
            >
              Retry
            </button>
          </p>
        ) : null}
      </div>

      {/* --- Selected, in the order the public page will render them ------- */}
      <div className="space-y-3">
        {selected.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            No amenities selected. Saving an empty list is fine — no amenities will be shown on the
            public project page.
          </p>
        ) : null}
        {selected.map((entry, index) => (
          <article
            key={entry.slug}
            className="space-y-2 rounded-lg border border-border/60 p-3"
            data-testid={`amenity-row-${entry.slug}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <IconMark icon={entry.icon} />
              <span className="font-medium">{entry.name}</span>
              {entry.isFeatured ? <Badge>Featured</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {[entry.category, entry.icon].filter(Boolean).join(" · ") || entry.slug}
            </p>

            <div className="space-y-1">
              <Label htmlFor={`amenity-note-${entry.slug}`}>Note for {entry.name}</Label>
              <Textarea
                id={`amenity-note-${entry.slug}`}
                rows={2}
                value={entry.note}
                disabled={save.isPending}
                onChange={(event) => setNote(entry.slug, event.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending || (atFeaturedLimit && !entry.isFeatured)}
                onClick={() => setFeatured(entry.slug, !entry.isFeatured)}
              >
                {entry.isFeatured ? `Unfeature ${entry.name}` : `Feature ${entry.name}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending || !canMove(index, -1)}
                onClick={() => move(entry.slug, "up")}
              >
                Move {entry.name} up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending || !canMove(index, 1)}
                onClick={() => move(entry.slug, "down")}
              >
                Move {entry.name} down
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => remove(entry.slug)}
              >
                Remove {entry.name}
              </Button>
            </div>
          </article>
        ))}
      </div>

      {atFeaturedLimit ? (
        <p className="text-sm text-muted-foreground">
          At most {STUDIO_MAX_FEATURED_AMENITIES} amenities can be featured. Unfeature one to
          feature another.
        </p>
      ) : null}

      {/* --- Catalogue picker --------------------------------------------- */}
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <Label htmlFor="amenity-search">Add an amenity</Label>
        <Input
          id="amenity-search"
          placeholder="Search by name or identifier"
          value={search}
          disabled={save.isPending}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Label htmlFor="amenity-category">Filter by category</Label>
        <select
          id="amenity-category"
          className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
          value={category}
          disabled={save.isPending}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value={AMENITY_CATEGORY_ALL}>All categories</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <div className="space-y-2">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No further amenities match. Create one below if it is missing.
            </p>
          ) : null}
          {available.map((entry) => (
            <Button
              key={entry.slug}
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={save.isPending}
              onClick={() => add(entry)}
            >
              Add {entry.name}
            </Button>
          ))}
        </div>
      </div>

      {/* --- Create a canonical amenity ----------------------------------- */}
      <details className="rounded-lg border border-border/60 p-3" data-testid="amenity-create">
        <summary className="cursor-pointer text-sm font-medium">Create a new amenity</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Only when the amenity is genuinely missing. A new amenity joins the shared catalogue
            every project draws from.
          </p>
          <div className="space-y-1">
            <Label htmlFor="amenity-new-name">Name</Label>
            <Input
              id="amenity-new-name"
              value={draft.name}
              disabled={save.isPending}
              onChange={(event) => {
                const name = event.target.value;
                // The slug follows the name until the Owner takes it over, and
                // never again after that — an editor that kept rewriting a
                // hand-chosen key would be fighting its user.
                setDraft((current) => ({
                  ...current,
                  name,
                  slug: slugTouched ? current.slug : suggestAmenitySlug(name),
                }));
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amenity-new-slug">Identifier</Label>
            <Input
              id="amenity-new-slug"
              value={draft.slug}
              disabled={save.isPending}
              onChange={(event) => {
                setSlugTouched(true);
                setDraft((current) => ({ ...current, slug: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amenity-new-category">Category (required)</Label>
            {/*
              A selector, not a text field. Category is what the public page
              groups by, so free text would let one heading become three across
              three projects. The list is the closed vocabulary the server and the
              save function enforce, so the Owner cannot choose something that
              would then be refused.
            */}
            <select
              id="amenity-new-category"
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={draft.category}
              disabled={save.isPending}
              onChange={(event) =>
                setDraft((current) => ({ ...current, category: event.target.value }))
              }
            >
              <option value="">Choose a category…</option>
              {STUDIO_AMENITY_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="amenity-new-icon">Icon name (optional)</Label>
            <Input
              id="amenity-new-icon"
              value={draft.icon}
              disabled={save.isPending}
              placeholder="Leave blank for the neutral marker"
              onChange={(event) =>
                setDraft((current) => ({ ...current, icon: event.target.value }))
              }
            />
          </div>

          {draftMatches.length ? (
            <div className="space-y-1" data-testid="amenity-close-matches">
              <p className="text-sm font-medium">These already exist — use one instead?</p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {draftMatches.map((match) => (
                  <li key={match.slug}>
                    {match.name} ({match.slug})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button type="button" disabled={save.isPending} onClick={stageCreated}>
            Add new amenity
          </Button>
        </div>
      </details>

      <div className="space-y-2">
        <Button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ selected, created })}
        >
          {save.isPending ? "Saving…" : "Save amenities"}
        </Button>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
    </section>
  );
}

/**
 * A neutral marker for an amenity, whatever its recorded icon.
 *
 * The `amenities.icon` column holds a free-text icon name, so no runtime
 * resolution of it can be trusted — and resolving one by dynamically importing
 * a module named after database content is exactly the pattern that turns a
 * typo into a broken bundle. The recorded name is shown as text in the row's
 * metadata line instead; this glyph is always the same, so a blank, unknown, or
 * hostile value renders identically and cannot break the list.
 */
function IconMark(props: { icon: string }) {
  return (
    <span
      aria-hidden="true"
      title={props.icon.trim() || undefined}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 text-xs text-muted-foreground"
    >
      •
    </span>
  );
}
