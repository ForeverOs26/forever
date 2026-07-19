import { describe, expect, it } from "vitest";

import { classifyPath, supportFor } from "../classify";

describe("Fast Intake classifier", () => {
  it("classifies conventional folders deterministically", () => {
    expect(classifyPath("root-0/price-list/price-list.json").category).toBe("price-list");
    expect(classifyPath("root-0/brochure/e-brochure.pdf").category).toBe("brochure");
    expect(classifyPath("root-0/masterplan/site.pdf").category).toBe("master-plan");
    expect(classifyPath("root-0/unit-plans/A-101.pdf").category).toBe("unit-plan");
    expect(classifyPath("root-0/images/render.jpg").category).toBe("photo");
    expect(classifyPath("root-0/videos/flythrough.mp4").category).toBe("video");
    expect(classifyPath("root-0/documents/company profile.pdf").category).toBe("legal-document");
    expect(classifyPath("root-0/facts/project-facts.json").category).toBe("project-facts");
  });

  it("classifies by filename keyword when no folder signal exists", () => {
    expect(classifyPath("root-0/CLK - Price List V2.pdf").category).toBe("price-list");
    expect(classifyPath("root-0/Payment Plan.pdf").category).toBe("payment-plan");
    expect(classifyPath("root-0/Company Profile.pdf").category).toBe("developer-profile");
    expect(classifyPath("root-0/Location Map.jpeg").category).toBe("map-location");
  });

  it("falls back to media/archive by extension and marks the rest unknown", () => {
    expect(classifyPath("root-0/loose/photo.png").category).toBe("photo");
    expect(classifyPath("root-0/loose/clip.mov").category).toBe("video");
    expect(classifyPath("root-0/loose/bundle.zip").category).toBe("archive");
    expect(classifyPath("root-0/loose/notes.xyz").category).toBe("unknown");
    expect(classifyPath("root-0/loose/random.pdf").category).toBe("unknown");
  });

  it("only treats recognized json artifacts as structured (never a filename as proof)", () => {
    expect(supportFor("price-list", ".json")).toBe("structured");
    expect(supportFor("project-facts", ".json")).toBe("structured");
    // A price list as a raw PDF is inventoried, never extracted in v1.
    expect(supportFor("price-list", ".pdf")).toBe("inventoried");
    expect(supportFor("brochure", ".json")).toBe("inventoried");
    expect(supportFor("unknown", ".pdf")).toBe("unsupported");
  });

  it("is deterministic for the same input", () => {
    const a = classifyPath("root-0/price-list/price-list.json");
    const b = classifyPath("root-0/price-list/price-list.json");
    expect(a).toEqual(b);
  });
});
