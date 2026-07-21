/**
 * FOREVER-STUDIO-001 — resale listing behavior.
 *
 * A resale listing publishes directly from one authorized upload, without
 * requiring a complete (or any) project record, and renders fail-closed:
 * missing price stays NULL ("Price on request" at the UI), missing fields
 * stay absent.
 */

import { describe, expect, it } from "vitest";

import {
  processUploadJob,
  setListingPublication,
  startUploadJob,
  updateResaleListing,
} from "../server/service";
import { makeWorld, uploadAll, OWNER, PUBLISHER } from "./fakes";

describe("Studio resale listings", () => {
  it("publishes a complete synthetic resale listing with photos in one pass", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "resale_listing",
      resaleFacts: {
        title: "2-bedroom sea-view condo, Kamala",
        projectName: "The Title Coralina Kamala",
        locationText: "Kamala, Phuket",
        propertyType: "Condominium",
        bedrooms: 2,
        bathrooms: 2,
        areaSqm: 78.5,
        price: 8_900_000,
        currency: "THB",
        description: "Corner unit with a wide sea view, fully furnished.",
        contactPhone: "+66 76 000 000",
      },
      files: [{ name: "living-room.jpg" }, { name: "bedroom.jpg" }, { name: "view.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, PUBLISHER, started.jobId);

    expect(result.status).toBe("published");
    expect(result.listingId).toBeTruthy();
    expect(result.pagePath).toMatch(/^\/resale\/2-bedroom-sea-view-condo-kamala-/);
    const listing = world.data.listings[0];
    expect(listing.publication_status).toBe("published");
    expect(world.data.publicListings()).toHaveLength(1);
    expect(listing.photos).toHaveLength(3);
    expect(listing.photos[0]).toMatch(/^https:\/\/cdn\.test\/project-images\//);
    expect(listing.price).toBe(8_900_000);
    expect(listing.currency).toBe("THB");
    expect(world.data.audits.some((row) => row.action === "studio_resale_published")).toBe(true);
  });

  it("publishes without a project record, price, or title — nothing blocks", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { bedrooms: 3, locationText: "Rawai" },
      files: [{ name: "house.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    const listing = world.data.listings[0];
    // Fail-closed fields: no invented price, currency, or project link.
    expect(listing.price).toBeNull();
    expect(listing.currency).toBeNull();
    expect(listing.project_id).toBeNull();
    expect(listing.title).toBe("3-bedroom resale");
    expect(result.warnings.some((warning) => warning.code === "listing_title_derived")).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "location_unresolved")).toBe(true);
  });

  it("links the canonical project when one matches, keeps raw text otherwise", async () => {
    const world = makeWorld();
    // Create the project first through the normal Studio path.
    const projectJob = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Coralina" },
      files: [],
    });
    await processUploadJob(world.deps, OWNER, projectJob.jobId);

    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Coralina resale unit", projectName: "Coralina" },
      files: [],
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    const listing = world.data.listings[0];
    expect(listing.project_id).toBe(world.executor.store.projects[0].id);
  });

  it("drops an invalid currency to NULL with a warning, never a default", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Currency test", price: 100, currency: "baht" },
      files: [],
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    expect(world.data.listings[0].currency).toBeNull();
    expect(result.warnings.some((warning) => warning.code === "currency_invalid_ignored")).toBe(
      true,
    );
  });

  it("supports edit, unpublish, and republish after publication", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Editable listing", price: 5_000_000, currency: "THB" },
      files: [],
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    const listingId = result.listingId!;

    await updateResaleListing(world.deps, OWNER, {
      listingId,
      facts: { price: 4_750_000, description: "Reduced for a quick sale." },
    });
    expect(world.data.listings[0].price).toBe(4_750_000);
    expect(world.data.listings[0].description).toBe("Reduced for a quick sale.");

    await setListingPublication(world.deps, OWNER, { listingId, publish: false });
    expect(world.data.publicListings()).toHaveLength(0);
    await setListingPublication(world.deps, OWNER, { listingId, publish: true });
    expect(world.data.publicListings()).toHaveLength(1);
  });

  it("re-processing a published resale job never duplicates the listing", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Idempotent listing" },
      files: [],
    });
    await processUploadJob(world.deps, OWNER, started.jobId);
    await processUploadJob(world.deps, OWNER, started.jobId);
    expect(world.data.listings).toHaveLength(1);
  });
});
