/**
 * Forever Studio dashboard: catalogue state, quick workflow entry points,
 * recent upload jobs, and (for the Owner) publisher management.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  studioGetOverview,
  studioSetListingPublication,
  studioSetProjectPublication,
} from "../studio.functions";
import {
  projectPagePath,
  resalePagePath,
  STUDIO_WORKFLOW_LABELS,
  STUDIO_WORKFLOWS,
  type StudioWorkflow,
} from "../studio-types";

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
  const overview = useQuery({
    queryKey: STUDIO_OVERVIEW_KEY,
    queryFn: () => studioGetOverview(),
    retry: false,
  });

  const projectPublication = useMutation({
    mutationFn: (input: { slug: string; publish: boolean }) =>
      studioSetProjectPublication({ data: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
  });
  const listingPublication = useMutation({
    mutationFn: (input: { listingId: string; publish: boolean }) =>
      studioSetListingPublication({ data: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
  });

  if (overview.isPending) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading Studio…</p>;
  }
  if (overview.isError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h2 className="text-lg font-semibold">Studio access denied</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {overview.error instanceof Error
            ? overview.error.message
            : "This account is not an active Forever Studio member."}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Studio membership is granted by the Owner. There is no self-registration.
        </p>
      </div>
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
            {data.jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2"
              >
                <span className="flex-1 truncate">
                  {STUDIO_WORKFLOW_LABELS[job.workflow]}
                  {job.projectSlug ? ` · ${job.projectSlug}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">{job.creatorEmail ?? ""}</span>
                <Badge
                  variant={
                    job.status === "published"
                      ? "default"
                      : job.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {job.status}
                </Badge>
              </li>
            ))}
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
