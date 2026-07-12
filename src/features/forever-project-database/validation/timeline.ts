/**
 * Forever Canonical Project Database — timeline validation.
 *
 * Structural guards over a {@link ProjectTimeline}: the project reference
 * must be present, the events must be a list of known event kinds with
 * coherent references — an event about a revision, snapshot, or merge should
 * name the entity it is about (a missing reference is flagged, never
 * fabricated), and every caller-supplied time is judged by the module's one
 * timestamp rule. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ProjectTimeline } from "../timeline";
import { isKnownProjectTimelineEventKind } from "../timeline";
import { projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { projectTimestampIssues } from "./value";

/** Validate a whole timeline. `base` locates it, defaulting to `timeline`. */
export function validateProjectTimeline(
  timeline: ProjectTimeline,
  base = "timeline",
): ProjectDatabaseIssue[] {
  if (isAbsent(timeline)) {
    return [projectDatabaseError("missing_timeline", "Timeline is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(timeline.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_timeline_project",
        "Timeline names no canonical project",
        `${base}.projectId`,
      ),
    );
  }

  if (!Array.isArray(timeline.events)) {
    issues.push(
      projectDatabaseError(
        "invalid_timeline_events",
        "Timeline events must be a list",
        `${base}.events`,
      ),
    );
    return issues;
  }

  timeline.events.forEach((event, index) => {
    const eventBase = `${base}.events.${index}`;
    if (isAbsent(event)) {
      issues.push(
        projectDatabaseError("missing_timeline_event", "Timeline event is absent", eventBase),
      );
      return;
    }
    if (!isKnownProjectTimelineEventKind(event.kind)) {
      issues.push(
        projectDatabaseError(
          "unknown_timeline_event",
          `Timeline event has an unknown kind "${String(event.kind)}"`,
          `${eventBase}.kind`,
        ),
      );
    }
    if (event.occurredAt !== undefined) {
      issues.push(
        ...projectTimestampIssues(
          event.occurredAt,
          "occurred_time",
          "Timeline event declares an empty occurred time",
          `${eventBase}.occurredAt`,
        ),
      );
    }
    for (const [key, code] of [
      ["revisionId", "empty_revision_reference"],
      ["snapshotId", "empty_snapshot_reference"],
      ["mergeId", "empty_merge_reference"],
      ["description", "empty_event_description"],
    ] as const) {
      const value = event[key];
      if (value !== undefined && !isNonEmptyString(value)) {
        issues.push(
          projectDatabaseError(
            code,
            `Timeline event declares an empty ${key}`,
            `${eventBase}.${key}`,
          ),
        );
      }
    }
    // An event about a revision, snapshot, or merge should say which one — a
    // missing reference is reported, never fabricated.
    if (event.kind === "revision" && event.revisionId === undefined) {
      issues.push(
        projectDatabaseWarning(
          "event_without_reference",
          "Revision event names no revision",
          `${eventBase}.revisionId`,
        ),
      );
    }
    if (event.kind === "snapshot" && event.snapshotId === undefined) {
      issues.push(
        projectDatabaseWarning(
          "event_without_reference",
          "Snapshot event names no snapshot",
          `${eventBase}.snapshotId`,
        ),
      );
    }
    if (event.kind === "merge" && event.mergeId === undefined) {
      issues.push(
        projectDatabaseWarning(
          "event_without_reference",
          "Merge event names no merge description",
          `${eventBase}.mergeId`,
        ),
      );
    }
  });

  return issues;
}
