/**
 * Forever Sync — shared test fixtures.
 *
 * Deterministic builders for sync jobs, endpoints, policies, schedules,
 * triggers, context, and results. Every builder takes a partial override so
 * tests state only what they exercise.
 */

import type { SyncPolicy } from "../policy";
import { emptySyncStats } from "../result";
import type { SyncSchedule, SyncTrigger } from "../schedule";
import type {
  SyncContext,
  SyncJob,
  SyncMetadata,
  SyncSource,
  SyncStats,
  SyncTarget,
} from "../types";

export function makeSource(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    id: "forever-db-projects",
    role: "source",
    system: "forever_database",
    protocol: "memory",
    label: "Forever Database projects",
    ...overrides,
  };
}

export function makeTarget(overrides: Partial<SyncTarget> = {}): SyncTarget {
  return {
    id: "website-projects",
    role: "target",
    system: "website",
    protocol: "http",
    label: "Website projects",
    ...overrides,
  };
}

export function makeJob(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: "job-1",
    name: "Publish projects to the website",
    direction: "push",
    entityKind: "project",
    source: makeSource(),
    target: makeTarget(),
    enabled: true,
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<SyncPolicy> = {}): SyncPolicy {
  return {
    id: "policy-1",
    conflictStrategy: "manual",
    retry: { maxAttempts: 1, backoff: "none" },
    allowDeletes: false,
    dryRunOnly: true,
    ...overrides,
  };
}

export function makeSchedule(overrides: Partial<SyncSchedule> = {}): SyncSchedule {
  return {
    id: "schedule-1",
    kind: "interval",
    intervalSeconds: 3600,
    ...overrides,
  };
}

export function makeTrigger(overrides: Partial<SyncTrigger> = {}): SyncTrigger {
  return {
    id: "trigger-1",
    kind: "manual",
    enabled: true,
    ...overrides,
  };
}

export function makeContext(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    job: makeJob(),
    now: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeStats(overrides: Partial<SyncStats> = {}): SyncStats {
  return { ...emptySyncStats(), ...overrides };
}

export function makeMetadata(overrides: Partial<SyncMetadata> = {}): SyncMetadata {
  const job = overrides.job ?? makeJob();
  return {
    job,
    syncedAt: "2026-01-01T00:00:00.000Z",
    direction: job.direction,
    recordCount: 0,
    ...overrides,
  };
}
