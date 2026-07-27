/**
 * Project Identity Resolver: update the right project, create only a genuinely
 * new one, and refuse to guess when the evidence points two ways.
 */

import { describe, expect, it } from "vitest";

import { distinctiveTokens, identityKey, resolveIdentity, slugify } from "../identity";

import { FakeIdentityReader, productionProject } from "./fixtures";

const PRODUCTION = new FakeIdentityReader([
  productionProject("modeva", "Modeva"),
  productionProject("the-title-legendary", "The Title Legendary Bang-Tao"),
  productionProject("the-adora", "Adora Rawai"),
  productionProject("coralina", "The Title Coralina Kamala", "draft"),
]);

describe("normalization", () => {
  it("collapses article, case, punctuation and suffix spellings to one key", () => {
    const key = identityKey("The Modeva");
    expect(identityKey("Modeva")).toBe(key);
    expect(identityKey("THE  MODEVA")).toBe(key);
    expect(identityKey("the-modeva")).toBe(key);
    expect(identityKey("The Modeva Residences")).toBe(key);
  });

  it("keeps a brand prefix distinct in the key — containment resolves it later", () => {
    // "Title" is a real brand word, not a generic one, so it is NOT dropped
    // from the key. "The Title Modeva" vs "Modeva" is settled by the resolver's
    // distinctive-token containment step, which is tested below.
    expect(identityKey("The Title Modeva")).not.toBe(identityKey("Modeva"));
  });

  it("transliterates Cyrillic spellings to the same key", () => {
    expect(identityKey("Модева")).toBe(identityKey("Modeva"));
  });

  it("drops generic words but keeps the distinctive ones", () => {
    expect(distinctiveTokens("The Title Coralina Kamala")).toEqual(["title", "coralina", "kamala"]);
  });

  it("produces a database-shaped slug", () => {
    expect(slugify("The Title Sierra")).toBe("the-title-sierra");
    expect(slugify("Coralina  Kamala!")).toBe("coralina-kamala");
  });
});

describe("resolution", () => {
  it("resolves an existing project and preserves its stored slug and name", async () => {
    const result = await resolveIdentity({ hint: { name: "The Title Modeva" } }, PRODUCTION);
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("modeva");
    expect(result.name).toBe("Modeva");
    expect(result.projectId).toBe("id-modeva");
    expect(result.operation).toBe("update");
  });

  it("honours an explicit existing_slug hint above inference", async () => {
    const result = await resolveIdentity(
      { hint: { name: "Something Else Entirely", existing_slug: "modeva" } },
      PRODUCTION,
    );
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("modeva");
  });

  it("resolves an existing_forever_record source the same way", async () => {
    const result = await resolveIdentity({ existingRecordSlugs: ["the-adora"] }, PRODUCTION);
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("the-adora");
  });

  it("reports the draft status of an existing record", async () => {
    const result = await resolveIdentity({ hint: { name: "Coralina" } }, PRODUCTION);
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("coralina");
    expect(result.publicStatus).toBe("draft");
  });

  it("creates a new project when nothing matches", async () => {
    const result = await resolveIdentity({ hint: { name: "The Title Sierra" } }, PRODUCTION);
    expect(result.outcome).toBe("resolved_new");
    expect(result.slug).toBe("the-title-sierra");
    expect(result.operation).toBe("create");
  });

  it("resolves a brand-prefixed name against its shorter production name", async () => {
    const result = await resolveIdentity({ hint: { name: "The Title Modeva" } }, PRODUCTION);
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("modeva");
  });

  it("prefers an exact name match over a merely containing one", async () => {
    const reader = new FakeIdentityReader([
      productionProject("sierra", "Sierra"),
      productionProject("sierra-bangtao", "Sierra Bangtao"),
    ]);
    const result = await resolveIdentity({ hint: { name: "Sierra" } }, reader);
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("sierra");
  });

  it("returns ambiguous_identity when two production projects match equally", async () => {
    const reader = new FakeIdentityReader([
      productionProject("sierra-bangtao", "Sierra Bangtao"),
      productionProject("sierra-kamala", "Sierra Kamala"),
    ]);
    const result = await resolveIdentity({ hint: { name: "Sierra" } }, reader);
    expect(result.outcome).toBe("ambiguous_identity");
    expect(result.slug).toBeNull();
    expect(result.candidates.map((c) => c.slug).sort()).toEqual([
      "sierra-bangtao",
      "sierra-kamala",
    ]);
  });

  it("returns ambiguous_identity when there is no usable name at all", async () => {
    const result = await resolveIdentity({}, PRODUCTION);
    expect(result.outcome).toBe("ambiguous_identity");
    expect(result.slug).toBeNull();
  });

  it("honours an Owner-stated existing slug when production was not consulted", async () => {
    // A generate-only run reads no credential, so the reader has no view. That
    // must not be read as "the project is absent": the Owner named it.
    const noView = {
      async listProjects() {
        return null;
      },
    };
    const result = await resolveIdentity(
      { hint: { name: "The Title Coralina Kamala", existing_slug: "coralina" } },
      noView,
    );
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("coralina");
    expect(result.operation).toBe("update");
    expect(result.projectId).toBeNull();
    expect(result.evidence.join(" ")).toContain("production was not consulted");
  });

  it("treats an unnamed project as new when production was not consulted", async () => {
    const noView = {
      async listProjects() {
        return null;
      },
    };
    const result = await resolveIdentity({ hint: { name: "The Title Sierra" } }, noView);
    expect(result.outcome).toBe("resolved_new");
    expect(result.slug).toBe("the-title-sierra");
  });

  it("stays ambiguous with no view and no usable name", async () => {
    const noView = {
      async listProjects() {
        return null;
      },
    };
    expect((await resolveIdentity({}, noView)).outcome).toBe("ambiguous_identity");
  });

  it("matches through a declared alias", async () => {
    const result = await resolveIdentity(
      { hint: { name: "SIB", aliases: ["Adora Rawai"] } },
      PRODUCTION,
    );
    expect(result.outcome).toBe("resolved_existing");
    expect(result.slug).toBe("the-adora");
  });
});
