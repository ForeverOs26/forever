/**
 * Static contract tests over the progressive-ingestion migration draft.
 *
 * These are TEXT-LEVEL assertions (the focused Progressive ingestion tests
 * pattern): they prove the draft's security and behavior contract without
 * connecting to any database. No database execution is claimed.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260718113000_progressive_ingestion_v1.sql",
  "utf8",
);

/** Every project-scoped table whose public SELECT policy must require a
 * published active parent project. */
const PROJECT_SCOPED_POLICY_TABLES = [
  "public.units",
  "public.project_media",
  "public.investment_data",
  "public.buildings",
  "public.unit_price_history",
  "public.project_facilities",
  "public.sources",
  "public.project_assets",
  "public.documents",
  "public.images",
  "public.videos",
  "public.project_intelligence",
  "public.project_translations",
  "public.project_status_history",
  "public.project_tags",
  "public.project_amenities",
  "public.nearby_places",
  "public.project_seo",
];

describe("progressive migration — one atomic unit, no strict-lane coupling", () => {
  it("is a single transaction", () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it("touches no forever_import / forever_execution object and no approval machinery", () => {
    expect(migration).not.toContain("forever_import.");
    expect(migration).not.toContain("forever_execution.");
    for (const token of [
      "approval_digest",
      "execution_lock",
      "consumed_at",
      "SECURITY DEFINER",
      "prerequisite_execution",
      "import_execution_approvals",
      "import_execution_receipts",
    ]) {
      expect(migration).not.toContain(token);
    }
  });

  it("locks the RPC to service_role only", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.forever_progressive_ingest(JSONB) FROM PUBLIC;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.forever_progressive_ingest(JSONB) FROM anon;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.forever_progressive_ingest(JSONB) FROM authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.forever_progressive_ingest(JSONB) TO service_role;",
    );
  });
});

describe("progressive migration — idempotency and server-side payload hash", () => {
  it("stores a server-computed payload hash next to the client fingerprint", () => {
    expect(migration).toContain("payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain(
      "encode(sha256(convert_to((batch - 'batch_fingerprint')::text, 'UTF8')), 'hex')",
    );
    expect(migration).toContain("UNIQUE (project_id, batch_fingerprint)");
  });

  it("replays exact creates and rejects changed content under an old fingerprint", () => {
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("fingerprint_payload_mismatch");
    // the slug-exists failure must come AFTER the replay lookup
    const replayIndex = migration.indexOf("fingerprint_payload_mismatch");
    const slugExistsIndex = migration.indexOf("project_slug_exists");
    expect(replayIndex).toBeGreaterThan(-1);
    expect(slugExistsIndex).toBeGreaterThan(replayIndex);
  });
});

describe("progressive migration — publication isolation", () => {
  it("backfills currently visible rows to published BEFORE flipping the policy", () => {
    const backfill = migration.indexOf(
      "SET public_status = 'published'\n  WHERE is_active = true AND public_status IS DISTINCT FROM 'published'",
    );
    const policyFlip = migration.indexOf('"Published projects are viewable by everyone"');
    expect(backfill).toBeGreaterThan(-1);
    expect(policyFlip).toBeGreaterThan(backfill);
  });

  it("creates progressive projects as draft, never auto-published", () => {
    expect(migration).toContain("'draft',                       -- saved, NEVER auto-published");
    expect(migration).not.toContain("'published',                   -- saved");
  });

  it("requires a published active parent in every project-scoped public policy", () => {
    for (const table of PROJECT_SCOPED_POLICY_TABLES) {
      const createIndex = migration.indexOf(`ON ${table} FOR SELECT`);
      expect(createIndex, `${table} must have a replaced SELECT policy`).toBeGreaterThan(-1);
      const window = migration.slice(createIndex, createIndex + 700);
      expect(window, `${table} policy must require a published parent`).toContain(
        "p.public_status = 'published'",
      );
      expect(window, `${table} policy must keep the is_active guard`).toContain(
        "p.is_active = true",
      );
    }
  });

  it("exposes listings publicly only when published; drafts stay private", () => {
    expect(migration).toContain("publication_status TEXT NOT NULL DEFAULT 'draft'");
    expect(migration).toContain(
      "ON public.listings FOR SELECT\n  USING (publication_status = 'published');",
    );
  });
});

describe("progressive migration — currency truthfulness", () => {
  it("removes the silent THB default from unit_price_history", () => {
    expect(migration).toContain("ALTER COLUMN currency DROP DEFAULT");
    expect(migration).toContain("ALTER COLUMN currency DROP NOT NULL");
  });

  it("gives listings a nullable currency with no default", () => {
    expect(migration).toContain("currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')");
    expect(migration).not.toContain("currency TEXT NOT NULL DEFAULT 'THB'");
  });

  it("stores NULL for unknown price-row currency inside the RPC", () => {
    expect(migration).toContain(
      "NULLIF(trim(COALESCE(v_item->>'currency', '')), ''),  -- NULL when unknown",
    );
  });
});

describe("progressive migration — accidental-overwrite protection", () => {
  it("uses the building-name fallback only for new rows", () => {
    expect(migration).toContain("'Building ' || v_code");
    // The UPDATE branch must be presence-aware on name.
    expect(migration).toContain(
      "name = CASE WHEN v_item ? 'name' AND NULLIF(trim(v_item->>'name'), '') IS NOT NULL",
    );
  });

  it("updates media title and sort_order only when explicitly supplied", () => {
    expect(migration).toContain("title = CASE WHEN v_item ? 'title' AND v_item->>'title' IS NOT NULL");
    expect(migration).toContain(
      "sort_order = CASE WHEN v_item ? 'sort_order' AND v_item->>'sort_order' IS NOT NULL",
    );
  });

  it("resolves unit buildings inside the same project only, warning when absent", () => {
    expect(migration).toContain("building_unresolved");
    const resolution = migration.slice(
      migration.indexOf("-- Building resolution"),
      migration.indexOf("SELECT id INTO v_unit_id FROM public.units"),
    );
    expect(resolution).toContain("WHERE project_id = v_project_id");
  });

  it("scopes every child lookup by the resolved project id", () => {
    for (const marker of [
      "FROM public.buildings\n      WHERE project_id = v_project_id AND building_code = v_code",
      "FROM public.units\n      WHERE project_id = v_project_id AND unit_code = v_code",
      "FROM public.project_media\n      WHERE project_id = v_project_id",
    ]) {
      expect(migration).toContain(marker);
    }
  });
});

describe("progressive migration — warnings schema", () => {
  it("constrains scope to exactly one of project_id / listing_id", () => {
    expect(migration).toContain(
      "((project_id IS NOT NULL)::int + (listing_id IS NOT NULL)::int) = 1",
    );
  });

  it("constrains the entity vocabulary and keeps warnings internal", () => {
    expect(migration).toContain("'project', 'listing', 'developer', 'location',");
    expect(migration).toContain("'building', 'unit', 'price', 'media', 'document'");
    // internal-only: service_role grant, RLS on, and no public policy
    expect(migration).toContain("GRANT ALL ON public.ingestion_warnings TO service_role;");
    expect(migration).toContain(
      "ALTER TABLE public.ingestion_warnings ENABLE ROW LEVEL SECURITY;",
    );
    expect(migration).not.toContain("ON public.ingestion_warnings FOR SELECT");
  });
});
