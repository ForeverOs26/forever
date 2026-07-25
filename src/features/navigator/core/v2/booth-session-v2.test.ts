import { describe, expect, it } from "vitest";

import { emptyAnswers } from "../decision-profile";
import { profileV2FromLegacyAnswers, type DecisionProfileV2 } from "./profile";
import {
  BOOTH_V2_SESSION_VERSION,
  MAX_SHORTLIST,
  boothV2Reducer,
  buildProfileFromDraft,
  canCompleteContacted,
  canCompleteNoContact,
  contactedCompletionBlockers,
  createBoothV2Session,
  deserializeBoothV2Session,
  fullProfileComplete,
  hasGuestDataV2,
  quickProfileComplete,
  serializeBoothV2Session,
  type BoothV2Action,
  type BoothV2Session,
} from "./session";

function run(session: BoothV2Session, ...actions: BoothV2Action[]): BoothV2Session {
  return actions.reduce(boothV2Reducer, session);
}

function confirmedProfile(): DecisionProfileV2 {
  return {
    ...profileV2FromLegacyAnswers(emptyAnswers()),
    flowMode: "quick",
    confirmedAt: "2026-07-25T10:00:00.000Z",
  };
}

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function quickDraftSession(): BoothV2Session {
  return run(
    createBoothV2Session("ref-quick-12345678"),
    { type: "begin" },
    { type: "grantPermission" },
    { type: "chooseMode", mode: "quick" },
    { type: "setPurchasePurpose", value: "lifestyle" },
    { type: "quickNext" },
    { type: "setBudgetBand", value: "250_500k" },
    { type: "setBudgetCurrency", value: "EUR" },
    { type: "quickNext" },
    { type: "setPropertyType", value: "condominium" },
    { type: "quickNext" },
    { type: "setTimeline", value: "3_6m" },
  );
}

describe("Quick Profile flow", () => {
  it("completes with exactly its four required questions", () => {
    const session = quickDraftSession();
    expect(quickProfileComplete(session.draft)).toBe(true);
    const atSummary = run(session, { type: "quickNext" });
    expect(atSummary.screen).toBe("decision_summary");
  });

  it("does not require concerns, areas, email, or surname", () => {
    const session = quickDraftSession();
    expect(session.draft.nav.concerns).toHaveLength(0);
    expect(session.draft.preferredAreas).toHaveLength(0);
    expect(session.contact.email).toBe("");
    expect(session.contact.lastName).toBe("");
    expect(quickProfileComplete(session.draft)).toBe(true);
  });

  it("builds a V2 profile from the draft with the original currency preserved", () => {
    const session = quickDraftSession();
    const profile = buildProfileFromDraft(session, null, "2026-07-25T10:00:00.000Z");
    expect(profile?.flowMode).toBe("quick");
    expect(profile?.budget.originalCurrency).toBe("EUR");
    expect(profile?.canonicalThb).toBeNull(); // no FX config → no THB claim
    expect(profile?.confirmedAt).toBe("2026-07-25T10:00:00.000Z");
  });
});

describe("Full flow completeness", () => {
  it("requires NAV-001 answers AND the Search Essentials", () => {
    let session = run(
      createBoothV2Session("ref-full-12345678"),
      { type: "begin" },
      { type: "grantPermission" },
      { type: "chooseMode", mode: "full" },
      { type: "toggleMotivation", value: "second_home" },
      { type: "toggleGoal", value: "peace_privacy" },
      { type: "setBudgetBand", value: "500k_1m" },
      { type: "setTimeline", value: "ready_now" },
      { type: "toggleConcern", value: "ownership" },
    );
    expect(fullProfileComplete(session.draft)).toBe(false); // essentials missing
    session = run(
      session,
      { type: "setPropertyType", value: "villa" },
      { type: "setBedrooms", value: "2" },
      { type: "setHelpMeChooseArea", value: true },
      { type: "setReadiness", value: "ready" },
    );
    expect(fullProfileComplete(session.draft)).toBe(true);
  });
});

describe("Explicit back navigation", () => {
  it("walks quick substeps and screens backwards", () => {
    let session = quickDraftSession();
    expect(session.quickStep).toBe(3);
    session = run(session, { type: "back" });
    expect(session.quickStep).toBe(2);
    session = run(session, { type: "back" }, { type: "back" }, { type: "back" });
    expect(session.screen).toBe("mode_selection");
    session = run(session, { type: "back" });
    expect(session.screen).toBe("permission");
    session = run(session, { type: "back" });
    expect(session.screen).toBe("welcome");
    expect(run(session, { type: "back" }).screen).toBe("welcome");
  });

  it("walks the handoff tail backwards", () => {
    const base = { ...createBoothV2Session("ref-1234567890"), screen: "next_step" as const };
    const back1 = boothV2Reducer(base, { type: "back" });
    expect(back1.screen).toBe("handoff_waiting");
    const back2 = boothV2Reducer(back1, { type: "back" });
    expect(back2.screen).toBe("guide_assignment");
    const back3 = boothV2Reducer(back2, { type: "back" });
    expect(back3.screen).toBe("whatsapp_verification");
    const back4 = boothV2Reducer(back3, { type: "back" });
    expect(back4.screen).toBe("contact");
  });
});

describe("Shortlist of zero to four", () => {
  const confirmed = run(
    quickDraftSession(),
    { type: "quickNext" },
    {
      type: "confirmProfile",
      profile: confirmedProfile(),
    },
  );

  it("accepts one to four entries and rejects a fifth in the state model", () => {
    let session = run(
      confirmed,
      { type: "toggleShortlist", slug: "p1" },
      { type: "toggleShortlist", slug: "p2" },
      { type: "toggleShortlist", slug: "p3" },
      { type: "toggleShortlist", slug: "p4" },
    );
    expect(session.shortlist.entries).toHaveLength(MAX_SHORTLIST);
    session = run(session, { type: "toggleShortlist", slug: "p5" });
    expect(session.shortlist.entries).toHaveLength(MAX_SHORTLIST);
    expect(session.shortlist.entries.map((e) => e.slug)).not.toContain("p5");
  });

  it("supports zero-project completion and 'mentioned by guest'", () => {
    expect(confirmed.shortlist.entries).toHaveLength(0);
    const withMention = run(
      confirmed,
      { type: "toggleShortlist", slug: "p1" },
      { type: "setMentionedByGuest", slug: "p1", value: true },
    );
    expect(withMention.shortlist.entries[0]).toEqual({ slug: "p1", mentionedByGuest: true });
  });

  it("'Let my Guide prepare the shortlist' clears entries and vice versa", () => {
    const guidePrep = run(
      confirmed,
      { type: "toggleShortlist", slug: "p1" },
      { type: "setGuidePrepares", value: true },
    );
    expect(guidePrep.shortlist).toEqual({ entries: [], guidePrepares: true });
    const backToManual = run(guidePrep, { type: "toggleShortlist", slug: "p2" });
    expect(backToManual.shortlist.guidePrepares).toBe(false);
  });
});

describe("Editing a confirmed profile invalidates downstream state", () => {
  it("clears confirmation, shortlist, and handoff progress", () => {
    let session = run(
      quickDraftSession(),
      { type: "quickNext" },
      {
        type: "confirmProfile",
        profile: confirmedProfile(),
      },
    );
    session = run(
      session,
      { type: "toggleShortlist", slug: "p1" },
      { type: "contactSaved", at: "2026-07-25T10:05:00.000Z" },
      { type: "whatsappVerified", at: "2026-07-25T10:06:00.000Z", method: "wa_me_host_confirmed" },
    );
    const edited = run(session, { type: "editSection", target: "budget_timeline" });
    expect(edited.screen).toBe("quick_profile");
    expect(edited.confirmedProfile).toBeNull();
    expect(edited.shortlist.entries).toHaveLength(0);
    expect(edited.handoff.whatsapp.state).toBe("unverified");
    expect(edited.handoff.contactSavedAt).toBeNull();
  });
});

describe("Truthful completion gates", () => {
  function handoffReady(): BoothV2Session {
    let session = run(
      quickDraftSession(),
      { type: "quickNext" },
      {
        type: "confirmProfile",
        profile: confirmedProfile(),
      },
    );
    session = run(
      session,
      { type: "continueToContact" },
      { type: "setContactField", field: "firstName", value: "Anna" },
      { type: "setContactField", field: "whatsapp", value: "+79990001122" },
      { type: "setContactField", field: "preferredLanguage", value: "Русский" },
      { type: "setConsultationConsent", value: true },
      { type: "contactSaved", at: "t1" },
      { type: "whatsappVerified", at: "t2", method: "wa_me_host_confirmed" },
      { type: "continueToGuideAssignment" },
      {
        type: "guideAssigned",
        at: "t3",
        guide: { id: "g1", displayName: "Guide One", languages: ["Русский"] },
        reserve: null,
        fallbackReason: null,
      },
      { type: "guideAcknowledged", at: "t4" },
      { type: "continueToNextStep" },
      { type: "setNextStep", value: "30-minute consultation" },
    );
    return session;
  }

  it("blocks completion until every gate holds, then completes", () => {
    const session = handoffReady();
    expect(canCompleteContacted(session)).toBe(false);
    expect(contactedCompletionBlockers(session)).toEqual([
      "No exact consultation/contact time recorded and no live Guide message confirmed",
    ]);
    const stillActive = run(session, { type: "completeContacted" });
    expect(stillActive.outcome).toBe("active"); // fail closed

    const withTime = run(session, { type: "setConsultationTime", value: "Tomorrow 14:00" });
    expect(canCompleteContacted(withTime)).toBe(true);
    const completed = run(withTime, { type: "completeContacted" });
    expect(completed.outcome).toBe("contacted_complete");
    expect(completed.screen).toBe("completion");
  });

  it("accepts a confirmed live Guide message instead of an exact time", () => {
    const withLive = run(handoffReady(), { type: "recordFirstContact", at: "t5" });
    expect(canCompleteContacted(withLive)).toBe(true);
  });

  it("lists every missing gate by name", () => {
    const fresh = createBoothV2Session("ref-x-12345678");
    expect(contactedCompletionBlockers(fresh)).toEqual([
      "Decision Profile not confirmed",
      "WhatsApp not verified",
      "No named Guide assigned",
      "Next step not recorded",
      "No exact consultation/contact time recorded and no live Guide message confirmed",
    ]);
  });
});

describe("Respectful no-contact continuation", () => {
  it("declining contact clears every personal field before the QR screen", () => {
    let session = run(
      quickDraftSession(),
      { type: "quickNext" },
      {
        type: "confirmProfile",
        profile: confirmedProfile(),
      },
    );
    session = run(
      session,
      { type: "continueToContact" },
      { type: "setContactField", field: "firstName", value: "Anna" },
      { type: "setContactField", field: "whatsapp", value: "+79990001122" },
      { type: "declineContact" },
    );
    expect(session.screen).toBe("respectful_no_contact_qr");
    expect(session.contact.firstName).toBe("");
    expect(session.contact.whatsapp).toBe("");
    expect(canCompleteNoContact(session)).toBe(true);
    const finished = run(session, { type: "completeNoContact" });
    expect(finished.outcome).toBe("no_contact_qr");
  });
});

describe("Serialization is fail-closed and never leaks a previous guest", () => {
  it("round-trips an active session", () => {
    const session = quickDraftSession();
    const raw = serializeBoothV2Session(session, new Date(NOW).toISOString());
    const restored = deserializeBoothV2Session(raw, { nowMs: NOW + 1_000 });
    expect(restored).not.toBeNull();
    expect(restored?.draft.budgetBand).toBe("250_500k");
  });

  it("rejects malformed and unversioned payloads", () => {
    expect(deserializeBoothV2Session("not json", { nowMs: NOW })).toBeNull();
    expect(deserializeBoothV2Session("{}", { nowMs: NOW })).toBeNull();
    expect(
      deserializeBoothV2Session(JSON.stringify({ sessionVersion: 99, savedAt: "x", session: {} }), {
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("never rehydrates a completed or abandoned session", () => {
    const done = run(quickDraftSession(), { type: "markAbandoned" });
    const raw = serializeBoothV2Session(done, new Date(NOW).toISOString());
    expect(deserializeBoothV2Session(raw, { nowMs: NOW })).toBeNull();
  });

  it("drops stale guest data past the inactivity window", () => {
    const session = quickDraftSession();
    const raw = serializeBoothV2Session(session, new Date(NOW).toISOString());
    expect(
      deserializeBoothV2Session(raw, { nowMs: NOW + 10 * 60_000, maxAgeMs: 5 * 60_000 }),
    ).toBeNull();
  });

  it("re-validates the stored confirmed profile through the versioned parser", () => {
    const session = run(
      quickDraftSession(),
      { type: "quickNext" },
      {
        type: "confirmProfile",
        profile: confirmedProfile(),
      },
    );
    const tampered = JSON.parse(serializeBoothV2Session(session, new Date(NOW).toISOString()));
    tampered.session.confirmedProfile.profileVersion = 1;
    const restored = deserializeBoothV2Session(JSON.stringify(tampered), { nowMs: NOW });
    expect(restored?.confirmedProfile).toBeNull();
  });
});

describe("Reset and guest-data detection", () => {
  it("a reset session holds no prior guest data", () => {
    const session = run(quickDraftSession(), { type: "reset", clientRef: "ref-new-12345678" });
    expect(hasGuestDataV2(session)).toBe(false);
    expect(session.clientRef).toBe("ref-new-12345678");
    expect(session.sessionVersion).toBe(BOOTH_V2_SESSION_VERSION);
  });

  it("funnel events are marked at most once", () => {
    let session = createBoothV2Session("ref-e-12345678");
    session = run(
      session,
      { type: "markEventRecorded", event: "profile_started" },
      { type: "markEventRecorded", event: "profile_started" },
    );
    expect(session.recordedEvents).toEqual(["profile_started"]);
  });
});
