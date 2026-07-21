/**
 * FOREVER-STUDIO-001 — resale listing behavior (hardened).
 *
 * A resale listing publishes directly from one authorized upload without any
 * project record; seller contact data is stored ONLY in the private contact
 * store and never on the public listing row; the operation is atomic and
 * idempotent; and the page renders fail-closed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getListingDetail,
  processUploadJob,
  setListingPublication,
  startUploadJob,
  updateResaleListing,
} from "../server/service";
import { makeWorld, uploadAll, OWNER, PUBLISHER } from "./fakes";

const LISTING_SELECT = readFileSync(resolve(process.cwd(), "src/lib/listing-service.ts"), "utf8");

async function runResale(
  world: ReturnType<typeof makeWorld>,
  actor: typeof OWNER,
  input: Parameters<typeof startUploadJob>[2],
) {
  const started = await startUploadJob(world.deps, actor, input);
  uploadAll(world, started.uploads);
  const result = await processUploadJob(world.deps, actor, started.jobId);
  return { started, result };
}

describe("Studio resale listings", () => {
  it("publishes a complete synthetic resale listing with photos in one pass", async () => {
    const world = makeWorld();
    const { result } = await runResale(world, PUBLISHER, {
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
        contactName: "Seller Somchai",
      },
      files: [{ name: "living-room.jpg" }, { name: "bedroom.jpg" }, { name: "view.jpg" }],
    });

    expect(result.status).toBe("published");
    expect(result.pagePath).toMatch(/^\/resale\/2-bedroom-sea-view-condo-kamala-/);
    const listing = world.data.listings[0];
    expect(listing.publication_status).toBe("published");
    expect(world.data.publicListings()).toHaveLength(1);
    expect(listing.photos).toHaveLength(3);
    expect(listing.photos[0]).toMatch(/^https:\/\/cdn\.test\/project-images\//);
    expect(listing.price).toBe(8_900_000);
    expect(listing.currency).toBe("THB");
  });

  it("stores contact ONLY in the private contact store, never on the listing row", async () => {
    const world = makeWorld();
    const { result } = await runResale(world, OWNER, {
      workflow: "resale_listing",
      resaleFacts: {
        title: "Private contact listing",
        price: 5_000_000,
        currency: "THB",
        contactName: "Jane Seller",
        contactPhone: "+66 999",
        contactEmail: "jane@example.com",
      },
      files: [],
    });
    const listing = world.data.listings[0];
    // The public row carries no contact fields.
    expect(listing).not.toHaveProperty("contact_name");
    expect(listing).not.toHaveProperty("contact_phone");
    expect(listing).not.toHaveProperty("contact_email");
    expect(JSON.stringify(listing)).not.toContain("jane@example.com");
    // The private store holds them.
    const contact = world.data.contacts.get(result.listingId!);
    expect(contact).toMatchObject({
      contact_name: "Jane Seller",
      contact_phone: "+66 999",
      contact_email: "jane@example.com",
    });
    // Studio can read them back for the edit form.
    const detail = await getListingDetail(world.deps, OWNER, result.listingId!);
    expect(detail?.facts.contactEmail).toBe("jane@example.com");
  });

  it("the public listing reader selects no contact columns", () => {
    expect(LISTING_SELECT).not.toContain("contact_name");
    expect(LISTING_SELECT).not.toContain("contact_phone");
    expect(LISTING_SELECT).not.toContain("contact_email");
  });

  it("the public resale page routes enquiries through /contact and shows no contact", () => {
    const page = readFileSync(resolve(process.cwd(), "src/routes/resale.$slug.tsx"), "utf8");
    expect(page).toContain("/contact");
    expect(page).not.toContain("contact_phone");
    expect(page).not.toContain("contact_email");
  });

  it("publishes without a project record, price, or title — nothing blocks", async () => {
    const world = makeWorld();
    const { result } = await runResale(world, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { bedrooms: 3, locationText: "Rawai" },
      files: [{ name: "house.jpg" }],
    });
    expect(result.status).toBe("published");
    const listing = world.data.listings[0];
    expect(listing.price).toBeNull();
    expect(listing.currency).toBeNull();
    expect(listing.project_id).toBeNull();
    expect(listing.title).toBe("3-bedroom resale");
  });

  it("drops an invalid currency to NULL with a warning, never a default", async () => {
    const world = makeWorld();
    const { result } = await runResale(world, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Currency test", price: 100, currency: "baht" },
      files: [],
    });
    expect(result.status).toBe("published");
    expect(world.data.listings[0].currency).toBeNull();
    expect(result.warnings.some((w) => w.code === "currency_invalid_ignored")).toBe(true);
  });

  it("supports edit (incl. private contact), unpublish, and republish", async () => {
    const world = makeWorld();
    const { result } = await runResale(world, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Editable listing", price: 5_000_000, currency: "THB" },
      files: [],
    });
    const listingId = result.listingId!;

    await updateResaleListing(world.deps, OWNER, {
      listingId,
      facts: { price: 4_750_000, description: "Reduced.", contactPhone: "+66 111" },
    });
    expect(world.data.listings[0].price).toBe(4_750_000);
    expect(world.data.contacts.get(listingId)?.contact_phone).toBe("+66 111");
    // The edited contact still never touches the public row.
    expect(JSON.stringify(world.data.listings[0])).not.toContain("+66 111");

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
