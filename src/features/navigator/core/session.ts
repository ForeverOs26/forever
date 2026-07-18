/**
 * One shared, serializable Navigator session model + reducer.
 *
 * Both presentation shells describe their state with the same model. It carries
 * only what is necessary — no secrets, device fingerprint, tracking, employee
 * identity, or browser metadata. Derived values (DecisionProfile,
 * RecommendationPath, catalogue results) are recomputed deterministically from
 * `answers`, so they are not stored; the async Forever Story is cached because it
 * is generated.
 */

import {
  toggleMaxThree,
  toggleSingle,
  type BudgetKey,
  type ConcernKey,
  type GoalKey,
  type MotivationKey,
  type NavigatorScreen,
  type TimelineKey,
} from "./questions";
import { emptyAnswers, type NavigatorAnswers } from "./decision-profile";
import type { ForeverStory, StoryStatus } from "./forever-story";

export type NavigatorMode = "website" | "booth";

/** Superset of screens across both shells. Each shell uses the subset it needs. */
export type SessionScreen = NavigatorScreen | "selected" | "contact";

export type LeadStatus = "idle" | "submitting" | "saved" | "error";

export interface NavigatorSession {
  mode: NavigatorMode;
  screen: SessionScreen;
  answers: NavigatorAnswers;
  storyStatus: StoryStatus;
  story: ForeverStory | null;
  storyConfirmed: boolean;
  selectedProjectSlug: string | null;
  leadStatus: LeadStatus;
}

export function createSession(mode: NavigatorMode): NavigatorSession {
  return {
    mode,
    screen: "welcome",
    answers: emptyAnswers(),
    storyStatus: "idle",
    story: null,
    storyConfirmed: false,
    selectedProjectSlug: null,
    leadStatus: "idle",
  };
}

/** True when the session holds any guest answer or detail — drives guarded reset. */
export function hasGuestData(session: NavigatorSession): boolean {
  const { answers } = session;
  return (
    answers.motivations.length > 0 ||
    answers.goals.length > 0 ||
    Boolean(answers.budget) ||
    Boolean(answers.timeline) ||
    answers.concerns.length > 0 ||
    answers.note.trim().length > 0 ||
    session.storyConfirmed ||
    session.selectedProjectSlug !== null ||
    session.screen !== "welcome"
  );
}

export type NavigatorAction =
  | { type: "begin" }
  | { type: "back" }
  | { type: "goToScreen"; screen: SessionScreen }
  | { type: "toggleMotivation"; value: MotivationKey }
  | { type: "toggleGoal"; value: GoalKey }
  | { type: "setBudget"; value: BudgetKey }
  | { type: "setTimeline"; value: TimelineKey }
  | { type: "toggleConcern"; value: ConcernKey }
  | { type: "setNote"; value: string }
  | { type: "startStory" }
  | { type: "storyResolved"; story: ForeverStory }
  | { type: "storyError" }
  | { type: "editStory"; screen: SessionScreen }
  | { type: "confirmStory" }
  | { type: "selectProject"; slug: string }
  | { type: "changeProject" }
  | { type: "continueToContact" }
  | { type: "leadSubmitting" }
  | { type: "leadSaved" }
  | { type: "leadError" }
  | { type: "replace"; session: NavigatorSession }
  | { type: "reset" };

/** Ordered question screens used for booth Back navigation. */
const BOOTH_BACK_ORDER: SessionScreen[] = [
  "welcome",
  "why_phuket",
  "success",
  "budget_timeline",
  "concern",
];

function previousScreen(screen: SessionScreen): SessionScreen {
  const index = BOOTH_BACK_ORDER.indexOf(screen);
  if (index > 0) return BOOTH_BACK_ORDER[index - 1];
  return "welcome";
}

export function navigatorReducer(
  state: NavigatorSession,
  action: NavigatorAction,
): NavigatorSession {
  switch (action.type) {
    case "begin":
      return { ...state, screen: "why_phuket" };
    case "back":
      return { ...state, screen: previousScreen(state.screen) };
    case "goToScreen":
      return { ...state, screen: action.screen };
    case "toggleMotivation":
      return {
        ...state,
        answers: {
          ...state.answers,
          motivations: toggleMaxThree(action.value, state.answers.motivations),
        },
      };
    case "toggleGoal":
      return {
        ...state,
        answers: { ...state.answers, goals: toggleMaxThree(action.value, state.answers.goals) },
      };
    case "setBudget":
      return {
        ...state,
        answers: { ...state.answers, budget: toggleSingle(action.value, state.answers.budget) },
      };
    case "setTimeline":
      return {
        ...state,
        answers: {
          ...state.answers,
          timeline: toggleSingle(action.value, state.answers.timeline),
        },
      };
    case "toggleConcern":
      return {
        ...state,
        answers: {
          ...state.answers,
          concerns: toggleMaxThree(action.value, state.answers.concerns),
        },
      };
    case "setNote":
      return { ...state, answers: { ...state.answers, note: action.value } };
    case "startStory":
      // Editing an answer invalidates a prior confirmation and cached story.
      return {
        ...state,
        screen: "forever_story",
        storyStatus: "loading",
        story: null,
        storyConfirmed: false,
      };
    case "storyResolved":
      return { ...state, storyStatus: "resolved", story: action.story };
    case "storyError":
      return { ...state, storyStatus: "error" };
    case "editStory":
      // Return to a question; downstream state (story, confirmation, selection)
      // is cleared so it recalculates from the edited answers.
      return {
        ...state,
        screen: action.screen,
        storyStatus: "idle",
        story: null,
        storyConfirmed: false,
        selectedProjectSlug: null,
      };
    case "confirmStory":
      return { ...state, storyConfirmed: true, screen: "recommendation" };
    case "selectProject":
      return { ...state, selectedProjectSlug: action.slug, screen: "selected" };
    case "changeProject":
      return { ...state, selectedProjectSlug: null, screen: "recommendation" };
    case "continueToContact":
      return { ...state, screen: "contact" };
    case "leadSubmitting":
      return { ...state, leadStatus: "submitting" };
    case "leadSaved":
      return { ...state, leadStatus: "saved", screen: "confirmation" };
    case "leadError":
      return { ...state, leadStatus: "error" };
    case "replace":
      return action.session;
    case "reset":
      return createSession(state.mode);
    default:
      return state;
  }
}

/* ---------- Persistence (sessionStorage) ---------- */

export const BOOTH_SESSION_STORAGE_KEY = "forever.booth.session.v1";

export function serializeSession(session: NavigatorSession): string {
  return JSON.stringify(session);
}

/** Parse a persisted session, returning null on anything malformed. */
export function deserializeSession(raw: string | null): NavigatorSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NavigatorSession>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.mode !== "website" && parsed.mode !== "booth") return null;
    if (!parsed.answers || typeof parsed.answers !== "object") return null;
    const base = createSession(parsed.mode);
    return {
      ...base,
      ...parsed,
      answers: { ...base.answers, ...parsed.answers },
    } as NavigatorSession;
  } catch {
    return null;
  }
}
