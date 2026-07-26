/**
 * FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001 — static contract of the direct
 * publish migration.
 *
 * The SQL text is the artifact under test. This migration is PENDING: it has
 * not been applied to production by this task. These assertions pin the
 * properties that make it safe to apply — additive, service_role only, locked
 * search path, single-project scope, and no change to the function it wraps.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = "supabase/migrations/20260726120000_forever_direct_publish.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");
/** Executable text only, so a comment can never satisfy a security assertion. */
const ddl = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("forever_direct_publish migration contract", () => {
  it("creates the atomic direct-publish function", () => {
    expect(ddl).toContain("CREATE OR REPLACE FUNCTION public.forever_direct_publish(batch JSONB");
    expect(ddl).toContain("RETURNS JSONB");
    expect(ddl).toContain("LANGUAGE plpgsql");
  });

  it("locks the search path and stays SECURITY INVOKER", () => {
    expect(ddl).toContain("SET search_path = ''");
    // SECURITY DEFINER would let a lesser role publish; it must be absent.
    expect(ddl).not.toContain("SECURITY DEFINER");
  });

  it("is executable only by service_role", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(ddl).toContain(
        `REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM ${role};`,
      );
    }
    expect(ddl).toContain(
      "GRANT EXECUTE ON FUNCTION public.forever_direct_publish(JSONB, JSONB) TO service_role;",
    );
  });

  it("requires the explicit Owner direct-publish stamps", () => {
    expect(ddl).toContain("'owner_approved_official'");
    expect(ddl).toContain("source_trust_required");
    expect(ddl).toContain("publication_mode_required");
  });

  it("composes the unchanged progressive ingest rather than altering it", () => {
    expect(ddl).toContain("public.forever_progressive_ingest(batch)");
    // It must not redefine, drop or re-grant the function it wraps.
    expect(ddl).not.toContain("CREATE OR REPLACE FUNCTION public.forever_progressive_ingest");
    expect(ddl).not.toContain("DROP FUNCTION IF EXISTS public.forever_progressive_ingest");
    expect(ddl).not.toMatch(/ALTER\s+FUNCTION\s+public\.forever_progressive_ingest/);
  });

  it("publishes only the single project the batch names", () => {
    // Exactly one UPDATE on projects, and it is id-scoped.
    const updates = ddl.match(/UPDATE public\.projects/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(ddl).toContain("WHERE id = v_project_id;");
    // No unscoped or slug-pattern publication of other rows.
    expect(ddl).not.toMatch(/UPDATE public\.projects[\s\S]*?WHERE\s+public_status/);
  });

  it("never reports a publication that did not happen", () => {
    expect(ddl).toContain("publication_not_applied");
    expect(ddl).toContain("'published'");
  });

  it("creates the media buckets idempotently and keeps evidence private", () => {
    expect(ddl).toContain("INSERT INTO storage.buckets (id, name, public)");
    expect(ddl).toContain("ON CONFLICT (id) DO NOTHING;");
    expect(ddl).toContain("('project-images', 'project-images', true)");
    expect(ddl).toContain("('forever-direct-evidence', 'forever-direct-evidence', false)");
    // No public-read policy is granted for the private evidence bucket.
    expect(ddl).not.toMatch(/forever-direct-evidence[\s\S]*CREATE POLICY/);
  });

  it("drops nothing and alters no existing table, policy or default", () => {
    expect(ddl).not.toMatch(/DROP\s+(TABLE|POLICY|COLUMN|INDEX|TRIGGER)/);
    expect(ddl).not.toMatch(/ALTER\s+TABLE/);
  });

  it("documents a real rollback path", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.forever_direct_publish(JSONB, JSONB);");
  });
});
