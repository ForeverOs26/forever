/**
 * Booth Mode 2.0 session hook.
 *
 * Wraps the V2 reducer with versioned sessionStorage persistence and the
 * privacy timers:
 *   • hydration is fail-closed (malformed / completed / stale payloads are
 *     discarded — the next guest never sees the previous guest's data);
 *   • an inactivity timer surfaces a Host warning, then auto-clears and
 *     reports the abandonment;
 *   • a completed (contacted or no-contact) session auto-clears shortly after
 *     the completion screen is shown;
 *   • manual "Start new guest" stays guarded by the confirm dialog upstream.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  BOOTH_V2_COMPLETED_CLEAR_MS,
  BOOTH_V2_INACTIVITY_TIMEOUT_MS,
  BOOTH_V2_INACTIVITY_WARNING_MS,
  BOOTH_V2_SESSION_STORAGE_KEY,
  boothV2Reducer,
  createBoothV2Session,
  deserializeBoothV2Session,
  hasGuestDataV2,
  serializeBoothV2Session,
  type BoothV2Action,
  type BoothV2Session,
} from "../core/v2";

function newClientRef(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `booth-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function initialSession(): BoothV2Session {
  return createBoothV2Session(newClientRef());
}

export interface UseBoothV2Session {
  session: BoothV2Session;
  dispatch: (action: BoothV2Action) => void;
  reset: () => void;
  /** True while the pre-clear Host inactivity warning is showing. */
  inactivityWarning: boolean;
  /** Keep the current session alive from the warning dialog. */
  dismissInactivityWarning: () => void;
}

export function useBoothV2Session(options?: {
  /** Called once when an inactive session is about to be auto-cleared. */
  onInactivityClear?: (session: BoothV2Session) => void;
  inactivityTimeoutMs?: number;
  warningMs?: number;
  completedClearMs?: number;
}): UseBoothV2Session {
  const inactivityTimeoutMs = options?.inactivityTimeoutMs ?? BOOTH_V2_INACTIVITY_TIMEOUT_MS;
  const warningMs = options?.warningMs ?? BOOTH_V2_INACTIVITY_WARNING_MS;
  const completedClearMs = options?.completedClearMs ?? BOOTH_V2_COMPLETED_CLEAR_MS;

  const [session, rawDispatch] = useReducer(boothV2Reducer, undefined, initialSession);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const hydrated = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const onInactivityClearRef = useRef(options?.onInactivityClear);
  onInactivityClearRef.current = options?.onInactivityClear;

  const dispatch = useCallback((action: BoothV2Action) => {
    lastActivityRef.current = Date.now();
    setInactivityWarning(false);
    rawDispatch(action);
  }, []);

  const reset = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(BOOTH_V2_SESSION_STORAGE_KEY);
    }
    lastActivityRef.current = Date.now();
    setInactivityWarning(false);
    rawDispatch({ type: "reset", clientRef: newClientRef() });
  }, []);

  // Hydrate once, client-only, after the SSR-matching first render.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (typeof window === "undefined") return;
    const stored = deserializeBoothV2Session(
      window.sessionStorage.getItem(BOOTH_V2_SESSION_STORAGE_KEY),
      { nowMs: Date.now(), maxAgeMs: inactivityTimeoutMs + warningMs },
    );
    if (stored) {
      rawDispatch({ type: "replace", session: stored });
    } else {
      // Anything unusable (malformed, finished, stale) is removed outright.
      window.sessionStorage.removeItem(BOOTH_V2_SESSION_STORAGE_KEY);
    }
  }, [inactivityTimeoutMs, warningMs]);

  // Persist on every change (client only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      BOOTH_V2_SESSION_STORAGE_KEY,
      serializeBoothV2Session(session, new Date().toISOString()),
    );
  }, [session]);

  // Inactivity: warn first, then clear. Only when guest data is at stake and
  // the session has not already finished (completed sessions clear below).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (session.outcome !== "active" || !hasGuestDataV2(session)) return;
    const intervalId = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= inactivityTimeoutMs + warningMs) {
        onInactivityClearRef.current?.(session);
        reset();
      } else if (idleMs >= inactivityTimeoutMs) {
        setInactivityWarning(true);
      }
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [session, inactivityTimeoutMs, warningMs, reset]);

  // A finished session never lingers on the tablet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (session.outcome === "active") return;
    const timeoutId = window.setTimeout(reset, completedClearMs);
    return () => window.clearTimeout(timeoutId);
  }, [session.outcome, completedClearMs, reset]);

  const dismissInactivityWarning = useCallback(() => {
    lastActivityRef.current = Date.now();
    setInactivityWarning(false);
  }, []);

  return { session, dispatch, reset, inactivityWarning, dismissInactivityWarning };
}
