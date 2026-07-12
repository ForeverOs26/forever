import { describe, expect, it } from "vitest";

import { listProjectSourceRelationshipTargets, projectSourceRelationships } from "..";

describe("relationships builder", () => {
  it("attaches every reference only when supplied (anti-fabrication)", () => {
    expect(projectSourceRelationships()).toEqual({});
    expect(
      projectSourceRelationships({
        registeredSourceId: "src_developer_website",
        supersedes: "psrc_coralina-price-list-v1-0-0",
        related: ["psrc_coralina-brochure-v1-0-0"],
      }),
    ).toEqual({
      registeredSourceId: "src_developer_website",
      supersedes: "psrc_coralina-price-list-v1-0-0",
      related: ["psrc_coralina-brochure-v1-0-0"],
    });
  });
});

describe("relationship targets", () => {
  it("lists catalogued targets in declared order, deduplicated, excluding the system reference", () => {
    const targets = listProjectSourceRelationshipTargets({
      registeredSourceId: "src_developer_website",
      supersedes: "psrc_a",
      supersededBy: "psrc_b",
      derivedFrom: "psrc_a",
      translationOf: "psrc_c",
      related: ["psrc_d", "psrc_b"],
    });
    expect(targets).toEqual(["psrc_a", "psrc_b", "psrc_c", "psrc_d"]);
  });

  it("returns an empty list for empty relationships", () => {
    expect(listProjectSourceRelationshipTargets({})).toEqual([]);
  });
});
