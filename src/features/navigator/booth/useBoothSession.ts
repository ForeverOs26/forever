/**
 * Booth session hook.
 *
 * Wraps the shared `navigatorReducer` with sessionStorage autosave (the simplest
 * persistence compatible with the handoff — no global state platform), and drives
 * the same ~900ms Forever Story generation the website uses. All domain logic
 * comes from the shared core; this hook only wires state + persistence + the
 * async story timer for the booth shell.
 */

import { useEffect, useReducer, useRef } from "react";

import {
  BOOTH_SESSION_STORAGE_KEY,
  buildForeverStory,
  createSession,
  deserializeSession,
  navigatorReducer,
  serializeSession,
  type NavigatorAction,
  type NavigatorSession,
} from "../core";

function initialSession(): NavigatorSession {
  return createSession("booth");
}

export interface UseBoothSession {
  session: NavigatorSession;
  dispatch: (action: NavigatorAction) => void;
  reset: () => void;
}

export function useBoothSession(): UseBoothSession {
  const [session, dispatch] = useReducer(navigatorReducer, undefined, initialSession);
  const hydrated = useRef(false);

  // Hydrate from sessionStorage once, on the client only, after the initial
  // (SSR-matching) render — avoids a hydration mismatch.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (typeof window === "undefined") return;
    const stored = deserializeSession(window.sessionStorage.getItem(BOOTH_SESSION_STORAGE_KEY));
    if (stored) {
      // A persisted "loading" story never resolves after a reload; settle it.
      const settled: NavigatorSession =
        stored.storyStatus === "loading"
          ? { ...stored, storyStatus: stored.story ? "resolved" : "idle" }
          : stored;
      dispatch({ type: "replace", session: settled });
    }
  }, []);

  // Persist on every change (client only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(BOOTH_SESSION_STORAGE_KEY, serializeSession(session));
  }, [session]);

  // Forever Story generation — mirrors the website's cached ~900ms reflection.
  useEffect(() => {
    if (session.storyStatus !== "loading") return;
    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "storyResolved", story: buildForeverStory(session.answers) });
    }, 900);
    return () => window.clearTimeout(timeoutId);
  }, [session.storyStatus, session.answers]);

  const reset = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(BOOTH_SESSION_STORAGE_KEY);
    }
    dispatch({ type: "reset" });
  };

  return { session, dispatch, reset };
}
