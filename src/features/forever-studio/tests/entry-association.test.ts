/**
 * The showroom-association rule, on its own.
 *
 * The Coralina end-to-end suite proves the rule inside the pipeline; this
 * proves the rule itself, where every edge is one cheap assertion instead of a
 * fifteen-second archive run. The cases that matter are the ones where being
 * wrong is expensive: a FALSE conflict silently withholds official material,
 * and a MISSED conflict puts another development's photographs in this
 * project's gallery.
 */

import { describe, expect, it } from "vitest";

import {
  associateEntryWithProject,
  declaredShowroomLocation,
  locationTokens,
  MANUAL_REVIEW_LOCATION_CONFLICT,
} from "../server/entry-association";

const KAMALA = ["Kamala, Phuket"];

function review(entryPath: string, projectLocation: string[] = KAMALA): boolean {
  return associateEntryWithProject({ entryPath, projectLocation }).needsManualReview;
}

describe("what counts as an explicitly declared showroom location", () => {
  it("reads the place after every introducer a developer actually writes", () => {
    expect(declaredShowroomLocation("Show Unit @Bangtao/x.jpg")).toBe("Bangtao");
    expect(declaredShowroomLocation("Show Unit - Bangtao/x.jpg")).toBe("Bangtao");
    expect(declaredShowroomLocation("Show Unit at Bangtao/x.jpg")).toBe("Bangtao");
    expect(declaredShowroomLocation("Sales Gallery, Bangtao/x.jpg")).toBe("Bangtao");
    expect(declaredShowroomLocation("Showroom @Kamala Beach/x.jpg")).toBe("Kamala Beach");
  });

  it("declares NOTHING when the segment names no place", () => {
    // The parent folder of Coralina's real show-unit tree.
    expect(declaredShowroomLocation("12. Photo of Show Units/x.jpg")).toBeNull();
    // A LAYOUT after the marker is not a location, and mistaking it for one
    // would quarantine an entire showroom's photography.
    expect(declaredShowroomLocation("Show Unit 2 Bedroom/x.jpg")).toBeNull();
    expect(declaredShowroomLocation("Show Unit - 2/x.jpg")).toBeNull();
  });

  it("ignores paths that are not about a showroom at all", () => {
    expect(declaredShowroomLocation("11. Perspective/Exterior/SKY POOL.jpg")).toBeNull();
    expect(declaredShowroomLocation("5. Floor Plan/JPG/A/plan.jpg")).toBeNull();
    expect(declaredShowroomLocation("Coralina Facilities.pdf")).toBeNull();
  });

  it("prefers the nearest declaring segment", () => {
    expect(
      declaredShowroomLocation("12. Photo of Show Units/Show Unit @Bangtao/1BR M-31/x.jpg"),
    ).toBe("Bangtao");
  });
});

describe("when a declared location conflicts with the project", () => {
  it("flags a showroom in a different place", () => {
    expect(review("12. Photo of Show Units/Show Unit @Bangtao/1BR M-31/1BR31 -  (1).jpg")).toBe(
      true,
    );
  });

  it("keeps a showroom in the project's own place", () => {
    expect(review("12. Photo of Show Units/Show Unit @Kamala/1 BR L 41 sqm/_DSC6667.jpg")).toBe(
      false,
    );
  });

  it("needs only ONE shared word, and ignores case and punctuation", () => {
    expect(review("Show Unit @KAMALA/x.jpg")).toBe(false);
    expect(review("Show Unit @Kamala Beach/x.jpg")).toBe(false);
    expect(review("Show Unit @kamala-beach/x.jpg")).toBe(false);
    // Matching on the province alone is enough: it is a shared word.
    expect(review("Show Unit @Phuket/x.jpg")).toBe(false);
  });

  it("is symmetric — nothing about any place is hardcoded", () => {
    expect(review("Show Unit @Bangtao/x.jpg", ["Bangtao, Phuket"])).toBe(false);
    expect(review("Show Unit @Kamala/x.jpg", ["Bangtao, Phuket"])).toBe(true);
  });

  it("CANNOT fire when the project's location is unknown", () => {
    // A conflict is a positive claim. With nothing to contradict, the rule
    // stays silent rather than quarantining material on a guess.
    for (const unknown of [[], [""], ["   "], [null as unknown as string]]) {
      expect(review("Show Unit @Bangtao/x.jpg", unknown as string[])).toBe(false);
    }
  });

  it("never fires on material that declares no showroom", () => {
    for (const path of [
      "11. Perspective/Exterior/SKY POOL.jpg",
      "4. Master Plan/Coralina Master Plan.pdf",
      "9. Map/CORALINA Map 1.jpeg",
      "20260401 Coralina Facilities.mp4",
      "12. Photo of Show Units/x.jpg",
    ]) {
      expect(review(path), path).toBe(false);
    }
  });
});

describe("location tokenization", () => {
  it("drops digits, fragments and words that carry no place meaning", () => {
    expect([...locationTokens("Kamala, Phuket")].sort()).toEqual(["kamala", "phuket"]);
    // `unit` and `show` are structural words, `1` and `br` are too short.
    expect([...locationTokens("Show Unit 1BR")]).toEqual([]);
    expect([...locationTokens("")]).toEqual([]);
    expect([...locationTokens(null)]).toEqual([]);
  });
});

describe("the outcome code", () => {
  it("is stable, and names the reason rather than the material", () => {
    expect(MANUAL_REVIEW_LOCATION_CONFLICT).toBe("manual_review_location_conflict");
    // It must not leak a filename, a place or a project into the code itself.
    expect(MANUAL_REVIEW_LOCATION_CONFLICT).not.toMatch(/coralina|bangtao|kamala|\.jpg/i);
  });
});
