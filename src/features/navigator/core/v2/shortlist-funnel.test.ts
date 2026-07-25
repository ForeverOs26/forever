/**
 * Shortlist identity strictness (PR #102 corrective item 11) and funnel
 * once-only semantics (item 12) at the shared-core level.
 */

import { describe, expect, it } from "vitest";

import { BOOTH_FUNNEL_EVENTS, isBoothFunnelEvent } from "./funnel";
import {
  MAX_SHORTLIST,
  boothV2Reducer,
  createBoothV2Session,
  shortlistMode,
  validateShortlist,
  type ShortlistV2,
} from "./session";

const shortlist = (entries: ShortlistV2["entries"], guidePrepares = false): ShortlistV2 => ({
  entries,
  guidePrepares,
});

describe("shortlist identity is strict", () => {
  it("accepts zero to four unique, non-blank slugs", () => {
    expect(validateShortlist(shortlist([]))).toBeNull();
    expect(
      validateShortlist(
        shortlist([
          { slug: "a", mentionedByGuest: false },
          { slug: "b", mentionedByGuest: true },
          { slug: "c", mentionedByGuest: false },
          { slug: "d", mentionedByGuest: false },
        ]),
      ),
    ).toBeNull();
  });

  it("rejects a fifth entry rather than truncating it", () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      slug: `p${index}`,
      mentionedByGuest: false,
    }));
    expect(validateShortlist(shortlist(five))).toBe("too_many");
  });

  it("rejects blank and over-long slugs", () => {
    expect(validateShortlist(shortlist([{ slug: "  ", mentionedByGuest: false }]))).toBe(
      "blank_slug",
    );
    expect(validateShortlist(shortlist([{ slug: "x".repeat(201), mentionedByGuest: false }]))).toBe(
      "slug_too_long",
    );
  });

  it("rejects a duplicate slug even when the entries disagree about mentionedByGuest", () => {
    expect(
      validateShortlist(
        shortlist([
          { slug: "same", mentionedByGuest: false },
          { slug: "same", mentionedByGuest: true },
        ]),
      ),
    ).toBe("duplicate_slug");
  });

  it("rejects guide-prepares combined with selected entries", () => {
    expect(validateShortlist(shortlist([{ slug: "a", mentionedByGuest: false }], true))).toBe(
      "guide_prepares_conflict",
    );
  });

  it("maps each coherent state to its database shortlist_mode", () => {
    expect(shortlistMode(shortlist([]))).toBe("none");
    expect(shortlistMode(shortlist([{ slug: "a", mentionedByGuest: false }]))).toBe(
      "guest_selected",
    );
    expect(shortlistMode(shortlist([], true))).toBe("guide_prepares");
  });

  it("the reducer never produces a shortlist the validator rejects", () => {
    let session = createBoothV2Session("ref-shortlist-1234");
    for (const slug of ["a", "b", "c", "d", "e", "a"]) {
      session = boothV2Reducer(session, { type: "toggleShortlist", slug });
    }
    expect(session.shortlist.entries.length).toBeLessThanOrEqual(MAX_SHORTLIST);
    expect(validateShortlist(session.shortlist)).toBeNull();
  });
});

describe("funnel vocabulary", () => {
  it("accepts only the eleven approved events", () => {
    expect(BOOTH_FUNNEL_EVENTS).toHaveLength(11);
    for (const event of BOOTH_FUNNEL_EVENTS) expect(isBoothFunnelEvent(event)).toBe(true);
    expect(isBoothFunnelEvent("anything_else")).toBe(false);
    expect(isBoothFunnelEvent("")).toBe(false);
  });

  it("marks an event recorded at most once, and only when asked to", () => {
    let session = createBoothV2Session("ref-funnel-1234");
    session = boothV2Reducer(session, { type: "markEventRecorded", event: "profile_started" });
    session = boothV2Reducer(session, { type: "markEventRecorded", event: "profile_started" });
    expect(session.recordedEvents).toEqual(["profile_started"]);
  });
});
