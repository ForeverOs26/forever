import { describe, expect, it } from "vitest";

import {
  PROJECT_TIMELINE_EVENT_KINDS,
  appendProjectTimelineEvent,
  emptyProjectTimeline,
  isKnownProjectTimelineEventKind,
  latestProjectTimelineEvent,
  projectTimelineEvent,
} from "..";

describe("timeline events", () => {
  it("declares the event kinds and guards them", () => {
    expect(PROJECT_TIMELINE_EVENT_KINDS).toEqual([
      "created",
      "revision",
      "snapshot",
      "merge",
      "note",
    ]);
    for (const kind of PROJECT_TIMELINE_EVENT_KINDS) {
      expect(isKnownProjectTimelineEventKind(kind)).toBe(true);
    }
    expect(isKnownProjectTimelineEventKind("deleted")).toBe(false);
  });

  it("builds events attaching only what was supplied — no fabricated timestamps", () => {
    expect(projectTimelineEvent("created")).toEqual({ kind: "created" });
    const event = projectTimelineEvent("revision", {
      occurredAt: "2026-07-12T00:00:00.000Z",
      revisionId: "prev_coralina-r2",
      description: "Second revision described",
    });
    expect(event.occurredAt).toBe("2026-07-12T00:00:00.000Z");
    expect(event.revisionId).toBe("prev_coralina-r2");
    expect("snapshotId" in event).toBe(false);
    expect("mergeId" in event).toBe(false);
  });
});

describe("timeline history", () => {
  it("starts empty, appends immutably, and resolves the latest event", () => {
    const timeline = emptyProjectTimeline("proj_coralina");
    expect(timeline).toEqual({ projectId: "proj_coralina", events: [] });
    expect(latestProjectTimelineEvent(timeline)).toBeUndefined();

    const first = projectTimelineEvent("created", { occurredAt: "2026-01-01T00:00:00.000Z" });
    const second = projectTimelineEvent("revision", { revisionId: "prev_coralina-r1" });
    const grown = appendProjectTimelineEvent(appendProjectTimelineEvent(timeline, first), second);
    expect(timeline.events).toHaveLength(0);
    expect(grown.events).toEqual([first, second]);
    expect(latestProjectTimelineEvent(grown)).toEqual(second);
  });

  it("is append-only: earlier events keep their position and content", () => {
    const timeline = appendProjectTimelineEvent(
      emptyProjectTimeline("proj_coralina"),
      projectTimelineEvent("created"),
    );
    const grown = appendProjectTimelineEvent(timeline, projectTimelineEvent("note"));
    expect(grown.events[0]).toEqual(projectTimelineEvent("created"));
    expect(grown.events).toHaveLength(2);
  });
});
