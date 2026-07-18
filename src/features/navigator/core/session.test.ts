import { describe, expect, it } from "vitest";

import {
  createSession,
  deserializeSession,
  hasGuestData,
  navigatorReducer,
  serializeSession,
  type NavigatorSession,
} from "./index";

function answered(): NavigatorSession {
  let session = createSession("booth");
  session = navigatorReducer(session, { type: "begin" });
  session = navigatorReducer(session, { type: "toggleMotivation", value: "investment" });
  session = navigatorReducer(session, { type: "toggleGoal", value: "rental_income" });
  session = navigatorReducer(session, { type: "setBudget", value: "500k_1m" });
  session = navigatorReducer(session, { type: "setTimeline", value: "ready_now" });
  session = navigatorReducer(session, { type: "toggleConcern", value: "ownership" });
  return session;
}

describe("guest data detection", () => {
  it("is false for a fresh session and true once anything is answered", () => {
    expect(hasGuestData(createSession("booth"))).toBe(false);
    expect(hasGuestData(answered())).toBe(true);
  });
});

describe("reset / Start new guest clears the complete guest session", () => {
  it("returns a pristine session preserving only the mode", () => {
    let session = answered();
    session = navigatorReducer(session, { type: "selectProject", slug: "the-modeva-bang-tao" });
    session = navigatorReducer(session, { type: "reset" });

    expect(session).toEqual(createSession("booth"));
    expect(session.answers.motivations).toEqual([]);
    expect(session.selectedProjectSlug).toBeNull();
    expect(session.screen).toBe("welcome");
    expect(hasGuestData(session)).toBe(false);
  });
});

describe("editing an answer clears downstream state", () => {
  it("editStory resets story, confirmation, and selection so they recalculate", () => {
    let session = answered();
    session = navigatorReducer(session, { type: "confirmStory" });
    session = navigatorReducer(session, { type: "selectProject", slug: "coralina" });
    expect(session.storyConfirmed).toBe(true);

    session = navigatorReducer(session, { type: "editStory", screen: "why_phuket" });
    expect(session.screen).toBe("why_phuket");
    expect(session.storyConfirmed).toBe(false);
    expect(session.story).toBeNull();
    expect(session.selectedProjectSlug).toBeNull();
  });

  it("starting the story invalidates a prior confirmation", () => {
    let session = answered();
    session = navigatorReducer(session, { type: "confirmStory" });
    session = navigatorReducer(session, { type: "startStory" });
    expect(session.storyConfirmed).toBe(false);
    expect(session.storyStatus).toBe("loading");
  });
});

describe("lead flow transitions", () => {
  it("advances to completion only via leadSaved", () => {
    let session = answered();
    session = navigatorReducer(session, { type: "leadSubmitting" });
    expect(session.leadStatus).toBe("submitting");
    session = navigatorReducer(session, { type: "leadSaved" });
    expect(session.leadStatus).toBe("saved");
    expect(session.screen).toBe("confirmation");
  });
});

describe("serialization", () => {
  it("round-trips a session and rejects malformed input", () => {
    const session = answered();
    const restored = deserializeSession(serializeSession(session));
    expect(restored).toEqual(session);

    expect(deserializeSession(null)).toBeNull();
    expect(deserializeSession("not json")).toBeNull();
    expect(deserializeSession(JSON.stringify({ mode: "nope" }))).toBeNull();
  });

  it("stores only necessary data — no secrets, tracking, or device metadata", () => {
    const keys = Object.keys(answered()).sort();
    expect(keys).toEqual(
      [
        "answers",
        "leadStatus",
        "mode",
        "screen",
        "selectedProjectSlug",
        "story",
        "storyConfirmed",
        "storyStatus",
      ].sort(),
    );
  });
});
