import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getOverview, resumeDueJobs, startUploadJob } from "../server/service";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";

describe("actor scoping before operational limits", () => {
  it("returns an older Publisher job behind 25 newer foreign jobs", async () => {
    const world = makeWorld();
    const own = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "new_development",
      projectFacts: { name: "Publisher history row" },
      files: [],
    });
    for (let index = 0; index < 25; index += 1) {
      await startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: `Newer foreign ${index}` },
        files: [],
      });
    }

    const overview = await getOverview(world.deps, PUBLISHER);
    expect(overview.jobs.map((job) => job.id)).toEqual([own.jobId]);
  });

  it("resumes a Publisher job behind five older foreign due jobs", async () => {
    const world = makeWorld();
    const foreignIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const foreign = await startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: `Foreign due ${index}` },
        files: [],
      });
      foreignIds.push(foreign.jobId);
      await world.data.requestJobProcessing(foreign.jobId, `foreign-${index}`, 900);
    }
    const own = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "new_development",
      projectFacts: { name: "Publisher due beyond five" },
      files: [],
    });
    await world.data.requestJobProcessing(own.jobId, "publisher-worker", 900);
    world.advanceMinutes(20);

    const resumed = await resumeDueJobs(world.deps, PUBLISHER);
    expect(resumed.results.map((result) => result.jobId)).toEqual([own.jobId]);
    expect(resumed.resumed).toBe(1);
    for (const id of foreignIds) {
      expect((await world.data.getJob(id))?.status).toBe("processing");
    }
  });

  it("returns Publisher objects behind 200 foreign projects and listings", async () => {
    const world = makeWorld();
    for (let index = 0; index < 200; index += 1) {
      const projectId = `foreign-project-${index}`;
      world.executor.store.projects.push({
        id: projectId,
        slug: projectId,
        name: `Foreign project ${index}`,
        developer_id: null,
        location_id: null,
        developer_name_raw: null,
        location_name_raw: null,
        location_area: null,
        public_status: "published",
        is_active: true,
        forever_verified: false,
        field_provenance: {},
      });
      world.data.objectOwners.set(`project:${projectId}`, OWNER.userId);

      const listingId = `foreign-listing-${index}`;
      world.data.listings.push({
        id: listingId,
        slug: listingId,
        title: `Foreign listing ${index}`,
        publication_status: "published",
        project_id: null,
        price: null,
        currency: null,
        photos: [],
        updated_at: null,
      });
      world.data.objectOwners.set(`listing:${listingId}`, OWNER.userId);
    }

    world.executor.store.projects.push({
      id: "publisher-project-beyond-200",
      slug: "publisher-project-beyond-200",
      name: "Publisher project beyond 200",
      developer_id: null,
      location_id: null,
      developer_name_raw: null,
      location_name_raw: null,
      location_area: null,
      public_status: "published",
      is_active: true,
      forever_verified: false,
      field_provenance: {},
    });
    world.data.objectOwners.set("project:publisher-project-beyond-200", PUBLISHER.userId);
    world.data.listings.push({
      id: "publisher-listing-beyond-200",
      slug: "publisher-listing-beyond-200",
      title: "Publisher listing beyond 200",
      publication_status: "published",
      project_id: null,
      price: null,
      currency: null,
      photos: [],
      updated_at: null,
    });
    world.data.objectOwners.set("listing:publisher-listing-beyond-200", PUBLISHER.userId);

    const overview = await getOverview(world.deps, PUBLISHER);
    expect(overview.projects.map((project) => project.id)).toEqual([
      "publisher-project-beyond-200",
    ]);
    expect(overview.listings.map((listing) => listing.id)).toEqual([
      "publisher-listing-beyond-200",
    ]);
  });

  it("places every production actor predicate before its corresponding limit", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/server/deps.server.ts"),
      "utf8",
    );
    const between = (start: string, end: string) => {
      const from = source.indexOf(start);
      const to = source.indexOf(end, from + start.length);
      return source.slice(from, to);
    };
    for (const segment of [
      between("async listProjects(createdBy)", "async getProjectDetail"),
      between("async listListings(createdBy)", "async createJob"),
    ]) {
      expect(segment.indexOf("query.in")).toBeGreaterThan(-1);
      expect(segment.indexOf("query.in")).toBeLessThan(segment.indexOf("limit(200)"));
    }
    for (const segment of [
      between("async listJobs(limit, createdBy)", "async listDueJobs"),
      between("async listDueJobs(staleSeconds, limit, createdBy)", "async requestJobProcessing"),
    ]) {
      expect(segment.indexOf("query.eq")).toBeGreaterThan(-1);
      expect(segment.indexOf("query.eq")).toBeLessThan(segment.lastIndexOf("limit("));
    }
  });
});
