/**
 * Forever Canonical Project Database — the canonical timeline.
 *
 * A {@link ProjectTimeline} is the append-only, ordered log of what happened
 * to one canonical record: it was created, a revision was described, a
 * snapshot was taken, a merge was described, or a note was recorded. Each
 * event carries only caller-supplied time — RC4.6 reads no clock, so an
 * event without a proven time simply has none (never a fabricated one).
 *
 * Deliberately distinct from the *Timeline* canonical section (which holds a
 * project's real-world milestones — completion dates, construction phases —
 * as canonical fields): this timeline is the record's own audit trail. The
 * helpers are pure and immutable: appending returns a new timeline and the
 * input is never mutated, so identical inputs always yield an equal result
 * and callers can share a timeline freely.
 */

import type { ISODateTime } from "@/features/forever-database";

/** What one timeline event records. */
export type ProjectTimelineEventKind = "created" | "revision" | "snapshot" | "merge" | "note";

/** Every {@link ProjectTimelineEventKind}, in a stable declared order. */
export const PROJECT_TIMELINE_EVENT_KINDS = [
  "created",
  "revision",
  "snapshot",
  "merge",
  "note",
] as const satisfies readonly ProjectTimelineEventKind[];

/** Runtime guard: whether a value is a known {@link ProjectTimelineEventKind}. */
export function isKnownProjectTimelineEventKind(value: unknown): value is ProjectTimelineEventKind {
  return (
    typeof value === "string" && (PROJECT_TIMELINE_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/** One event in a record's append-only audit trail. */
export interface ProjectTimelineEvent {
  kind: ProjectTimelineEventKind;
  /** When the event happened, supplied by the caller — never a clock read. */
  occurredAt?: ISODateTime;
  /** The revision the event concerns, when one does. */
  revisionId?: string;
  /** The snapshot the event concerns, when one does. */
  snapshotId?: string;
  /** The merge description the event concerns, when one does. */
  mergeId?: string;
  /** Free-text description of the event. */
  description?: string;
}

/** Options accepted by {@link projectTimelineEvent}. */
export interface ProjectTimelineEventOptions {
  occurredAt?: ISODateTime;
  revisionId?: string;
  snapshotId?: string;
  mergeId?: string;
  description?: string;
}

/**
 * Build a {@link ProjectTimelineEvent}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectTimelineEvent(
  kind: ProjectTimelineEventKind,
  options: ProjectTimelineEventOptions = {},
): ProjectTimelineEvent {
  const event: ProjectTimelineEvent = { kind };
  if (options.occurredAt !== undefined) event.occurredAt = options.occurredAt;
  if (options.revisionId !== undefined) event.revisionId = options.revisionId;
  if (options.snapshotId !== undefined) event.snapshotId = options.snapshotId;
  if (options.mergeId !== undefined) event.mergeId = options.mergeId;
  if (options.description !== undefined) event.description = options.description;
  return event;
}

/** The append-only audit trail of one canonical record. */
export interface ProjectTimeline {
  /** Canonical id of the project the timeline belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** Every recorded event, in append order. */
  events: ProjectTimelineEvent[];
}

/** An empty timeline for a project. */
export function emptyProjectTimeline(projectId: string): ProjectTimeline {
  return { projectId, events: [] };
}

/**
 * Append an event, returning a new {@link ProjectTimeline}.
 *
 * Immutable and append-only: the input timeline is never mutated, so
 * identical inputs always yield an equal result and callers can share a
 * timeline freely.
 */
export function appendProjectTimelineEvent(
  timeline: ProjectTimeline,
  event: ProjectTimelineEvent,
): ProjectTimeline {
  return { projectId: timeline.projectId, events: [...timeline.events, event] };
}

/** The most recently appended event, or `undefined` for an empty timeline. */
export function latestProjectTimelineEvent(
  timeline: ProjectTimeline,
): ProjectTimelineEvent | undefined {
  return timeline.events.length > 0 ? timeline.events[timeline.events.length - 1] : undefined;
}
