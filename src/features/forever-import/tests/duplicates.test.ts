import { describe, expect, it } from "vitest";

import { foreverDatabaseEntities } from "@/features/forever-database";

import { validateDuplicateEntities } from "../validation";
import { makeDeveloper, makeDocument, makeMedia } from "./fixtures";

describe("validateDuplicateEntities", () => {
  it("passes when natural keys are unique", () => {
    const media = [
      makeMedia({ id: "1", url: "https://x/a.jpg" }),
      makeMedia({ id: "2", url: "https://x/b.jpg" }),
    ];
    expect(validateDuplicateEntities(media, foreverDatabaseEntities.media, "media")).toEqual([]);
  });

  it("detects two media that describe the same asset despite different ids", () => {
    const media = [
      makeMedia({ id: "1", url: "https://x/a.jpg" }),
      makeMedia({ id: "2", url: "https://x/a.jpg" }),
    ];
    const issues = validateDuplicateEntities(media, foreverDatabaseEntities.media, "media");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("duplicate_entity");
    expect(issues[0].message).toContain("project-1::gallery_image::https://x/a.jpg");
  });

  it("detects developers colliding on slug", () => {
    const developers = [
      makeDeveloper({ id: "1", slug: "coralina-group" }),
      makeDeveloper({ id: "2", slug: "coralina-group" }),
    ];
    const issues = validateDuplicateEntities(
      developers,
      foreverDatabaseEntities.developer,
      "developers",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("coralina-group");
  });

  it("reports each colliding key once, deterministically", () => {
    const docs = [
      makeDocument({ id: "1", url: "https://x/d.pdf" }),
      makeDocument({ id: "2", url: "https://x/d.pdf" }),
      makeDocument({ id: "3", url: "https://x/d.pdf" }),
    ];
    const issues = validateDuplicateEntities(docs, foreverDatabaseEntities.document, "documents");
    expect(issues).toHaveLength(1);
  });
});
