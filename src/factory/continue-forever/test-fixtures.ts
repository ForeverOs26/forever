import { basePacket, type PacketOverrides } from "../execution-connector/test-fixtures";
import type { CurrentTaskEnvelope, PublishingAuthorization } from "./contracts";

/**
 * Shared hermetic fixtures for the Continue Forever tests. They build on the
 * FACTORY-A1-002 connector fixtures so the router, connector, and command are
 * exercised against the same deterministic packet shape. No time, randomness,
 * or I/O is involved.
 */

export interface EnvelopeOverrides {
  readonly isCurrent?: boolean;
  readonly supersededBy?: string | null;
  readonly publishing?: PublishingAuthorization;
  readonly packet?: PacketOverrides;
}

/** One current, approved, non-publishing envelope by default. */
export function baseEnvelope(overrides: EnvelopeOverrides = {}): CurrentTaskEnvelope {
  return {
    isCurrent: overrides.isCurrent ?? true,
    supersededBy: overrides.supersededBy ?? null,
    publishing: overrides.publishing,
    packet: basePacket({
      ...overrides.packet,
      // Default to no pull request so a plain run is prepare-only.
      handoff: { createPullRequest: false, ...overrides.packet?.handoff },
    }),
  };
}

/** A fixed clock: every call returns the same instant unless a sequence is given. */
export function fixedClock(instants: string[] = ["2026-07-14T00:00:00.000Z"]): () => string {
  let index = 0;
  return () => instants[Math.min(index++, instants.length - 1)];
}
