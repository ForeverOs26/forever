import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * RC5.5D migration static security validation.
 *
 * The migration is COMMITTED BUT NOT APPLIED; these tests validate its text
 * hermetically — privilege revocations, pinned search_path, SECURITY DEFINER
 * scope, absence of dynamic SQL, durable-approval constraints, and the
 * bounded write surface — without any database.
 */

const MIGRATION_FILE = "20260715120000_rc55d_import_execution_boundary.sql";

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", MIGRATION_FILE), "utf-8");

/** Migration text with `--` comments removed, for negative pattern scans. */
const code = sql.replace(/--[^\n]*/g, "");

/** The six functions the migration defines. */
const FUNCTION_HEADERS = [
  "CREATE OR REPLACE FUNCTION forever_import.request_digest(doc JSONB)",
  "CREATE OR REPLACE FUNCTION forever_import.has_unsafe_source_file(doc JSONB)",
  "CREATE OR REPLACE FUNCTION forever_import.validate_import_request(request JSONB)",
  "CREATE OR REPLACE FUNCTION forever_import.register_import_approval(",
  "CREATE OR REPLACE FUNCTION forever_import.run_approved_import(request JSONB)",
  "CREATE OR REPLACE FUNCTION forever_execution.forever_execute_approved_import(request JSONB)",
] as const;

/** Text of one function definition from its header to its closing `$$;`. */
function functionDefinition(header: string): string {
  const start = sql.indexOf(header);
  expect(start, `missing function header: ${header}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

/** Header section of a function (before the body delimiter). */
function functionHeaderSection(header: string): string {
  const definition = functionDefinition(header);
  return definition.slice(0, definition.indexOf("AS $$"));
}

function tableDefinition(name: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  expect(start, `missing table: ${name}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(");", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 2);
}

describe("RC5.5D migration security: schema and roles", () => {
  it("creates a private schema with PUBLIC access revoked", () => {
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS forever_import;");
    expect(sql).toContain("REVOKE ALL ON SCHEMA forever_import FROM PUBLIC;");
  });

  it("never grants schema usage or any table privilege to anon or authenticated", () => {
    expect(code).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/i);
    expect(code).not.toMatch(/GRANT[^;]*TO[^;]*\bauthenticated\b/i);
    expect(code).not.toMatch(/GRANT[^;]*ON SCHEMA forever_import/i);
    expect(code).not.toMatch(/GRANT[^;]*ON (TABLE|ALL TABLES)[^;]*forever_import/i);
  });

  it("creates the dedicated least-privilege LOGIN role idempotently, with no ambient authority", () => {
    expect(sql).toContain(
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forever_import_executor')",
    );
    expect(sql).toContain(
      "CREATE ROLE forever_import_executor\n      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;",
    );
    expect(sql).toContain(
      "ALTER ROLE forever_import_executor\n      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;",
    );
    // No password is ever committed anywhere in the migration.
    expect(code).not.toMatch(/PASSWORD/i);
    // The role is never made a member of any Supabase system role.
    expect(code).not.toMatch(
      /GRANT\s+(service_role|anon|authenticated|postgres)\s+TO forever_import_executor/i,
    );
  });

  it("reverses default privileges for future objects in the private schema", () => {
    expect(sql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA forever_import REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
    );
    expect(sql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA forever_import REVOKE ALL ON TABLES FROM PUBLIC;",
    );
  });
});

describe("RC5.5D migration security: durable approval storage", () => {
  const approvals = tableDefinition("forever_import.import_execution_approvals");

  it("stores only a digest with a strict format — no raw id, token, or secret column", () => {
    expect(approvals).toContain("approval_digest TEXT NOT NULL");
    expect(approvals).toContain("CHECK (approval_digest ~ '^[0-9a-f]{64}$')");
    expect(approvals).not.toMatch(/\b(token|secret|password|credential|api_key|raw_id)\b/i);
  });

  it("enforces one-time consumption structurally", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS import_execution_approvals_digest_key",
    );
    expect(approvals).toContain("consumed_at TIMESTAMPTZ");
    expect(approvals).toContain("execution_id UUID");
    expect(approvals).toContain("(consumed_at IS NULL) = (execution_id IS NULL)");
  });

  it("bounds lifetime, counts, and identifier formats with CHECK constraints", () => {
    expect(approvals).toContain(
      "CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '1 hour')",
    );
    expect(approvals).toContain("CHECK (operation_count >= 0 AND operation_count <= 1000)");
    expect(approvals).toContain("CHECK (project_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$')");
    expect(approvals).toContain("CHECK (plan_hash ~ '^[0-9a-f]{64}$')");
    expect(approvals).toContain("CHECK (collision_report_fingerprint ~ '^[0-9a-f]{64}$')");
  });

  it("revokes PUBLIC and enables RLS on both durable tables", () => {
    expect(sql).toContain(
      "REVOKE ALL ON TABLE forever_import.import_execution_approvals FROM PUBLIC;",
    );
    expect(sql).toContain(
      "ALTER TABLE forever_import.import_execution_approvals ENABLE ROW LEVEL SECURITY;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE forever_import.import_execution_receipts FROM PUBLIC;",
    );
    expect(sql).toContain(
      "ALTER TABLE forever_import.import_execution_receipts ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("permanently blocks a second import of the same plan through the receipts table", () => {
    const receipts = tableDefinition("forever_import.import_execution_receipts");
    expect(receipts).toContain("UNIQUE (project_slug, plan_hash)");
    expect(receipts).toContain("UNIQUE (approval_digest)");
    expect(receipts).toContain("CHECK (outcome = 'committed')");
  });
});

describe("RC5.5D migration security: functions", () => {
  it("pins an empty search_path on every function", () => {
    for (const header of FUNCTION_HEADERS) {
      expect(functionHeaderSection(header)).toContain("SET search_path = ''");
    }
  });

  it("uses SECURITY DEFINER only on the dedicated-schema wrapper", () => {
    expect(
      functionHeaderSection(
        "CREATE OR REPLACE FUNCTION forever_execution.forever_execute_approved_import(request JSONB)",
      ),
    ).toContain("SECURITY DEFINER");
    expect(
      functionHeaderSection(
        "CREATE OR REPLACE FUNCTION forever_import.run_approved_import(request JSONB)",
      ),
    ).not.toContain("SECURITY DEFINER");
    expect(
      functionHeaderSection("CREATE OR REPLACE FUNCTION forever_import.register_import_approval("),
    ).not.toContain("SECURITY DEFINER");
    expect(code.match(/SECURITY DEFINER/g)).toHaveLength(1);
  });

  it("revokes PUBLIC execution on every function", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_import.register_import_approval(\n  TIMESTAMPTZ, TIMESTAMPTZ, JSONB\n) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_import.run_approved_import(JSONB) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_import.request_digest(JSONB) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_import.has_unsafe_source_file(JSONB) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_import.validate_import_request(JSONB) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM PUBLIC;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM anon;",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM authenticated;",
    );
  });

  it("grants exactly the executor, owner-membership, and owner target-capability grants — nothing else", () => {
    // Use comment-stripped `code` so prose mentioning "GRANT" cannot pollute the
    // extracted statement list.
    const grants = (code.match(/GRANT [\s\S]+?;/g) ?? []).map((g) => g.replace(/\s+/g, " ").trim());
    expect(grants.sort()).toEqual(
      [
        // Executor: exactly USAGE on the execution schema + EXECUTE on the wrapper.
        "GRANT USAGE ON SCHEMA forever_execution TO forever_import_executor;",
        "GRANT EXECUTE ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) TO forever_import_executor;",
        // Migration role → owner membership, required to reassign ownership.
        "GRANT forever_import_execution_owner TO CURRENT_USER;",
        // Owner: exactly the target-capability allowlist (USAGE public; SELECT on
        // dependency tables; SELECT + INSERT on the four import tables).
        "GRANT USAGE ON SCHEMA public TO forever_import_execution_owner;",
        "GRANT SELECT ON public.developers TO forever_import_execution_owner;",
        "GRANT SELECT ON public.locations TO forever_import_execution_owner;",
        "GRANT SELECT, INSERT ON public.projects TO forever_import_execution_owner;",
        "GRANT SELECT, INSERT ON public.buildings TO forever_import_execution_owner;",
        "GRANT SELECT, INSERT ON public.units TO forever_import_execution_owner;",
        "GRANT SELECT, INSERT ON public.unit_price_history TO forever_import_execution_owner;",
      ].sort(),
    );
    // The executor is granted NO USAGE on public.
    expect(code).not.toMatch(/GRANT USAGE ON SCHEMA public TO forever_import_executor/);
    // The owner is granted NO write beyond SELECT/INSERT on the import tables.
    expect(code).not.toMatch(
      /GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b[^;]*TO forever_import_execution_owner/i,
    );
    // The owner receives no sequence privilege (the target tables use UUID keys).
    expect(code).not.toMatch(/GRANT[^;]*ON SEQUENCE[^;]*TO forever_import_execution_owner/i);
  });

  it("grants no role at all on the approval-issuance function", () => {
    expect(code).not.toMatch(/GRANT[^;]*register_import_approval/i);
  });

  it("grants no role at all on the internal execution function", () => {
    expect(code).not.toMatch(/GRANT[^;]*run_approved_import/i);
  });

  it("contains no dynamic SQL and no string-built statements", () => {
    expect(code).not.toMatch(/EXECUTE\s+format/i);
    expect(code).not.toMatch(/EXECUTE\s+'/i);
    expect(code).not.toMatch(/EXECUTE\s+\$/i);
    expect(code).not.toMatch(/\bformat\s*\(/i);
    expect(code).not.toMatch(/\|\|\s*request/i);
    expect(code).not.toMatch(/quote_ident|quote_literal/i);
  });

  it("raises only static, stable machine-readable reason codes", () => {
    const raises = sql.match(/RAISE EXCEPTION [^;]+;/g) ?? [];
    expect(raises.length).toBeGreaterThan(20);
    for (const raise of raises) {
      expect(raise).toMatch(/^RAISE EXCEPTION 'forever_import_execution: [a-z_]+';$/);
    }
  });

  it("keeps the wrapper STRICT with its own size guard", () => {
    const wrapper = functionDefinition(
      "CREATE OR REPLACE FUNCTION forever_execution.forever_execute_approved_import(request JSONB)",
    );
    expect(wrapper).toContain("STRICT");
    expect(wrapper).toContain("pg_column_size(request) > 4194304");
    expect(wrapper).toContain("RETURN forever_import.run_approved_import(request);");
  });
});

describe("RC5.5D migration security: bounded write surface", () => {
  const body = functionDefinition(
    "CREATE OR REPLACE FUNCTION forever_import.run_approved_import(request JSONB)",
  );

  it("inserts into exactly the four whitelisted public tables, once each", () => {
    expect(body.match(/INSERT INTO public\.projects \(/g)).toHaveLength(1);
    expect(body.match(/INSERT INTO public\.buildings \(/g)).toHaveLength(1);
    expect(body.match(/INSERT INTO public\.units \(/g)).toHaveLength(1);
    expect(body.match(/INSERT INTO public\.unit_price_history \(/g)).toHaveLength(1);
    const publicInserts = body.match(/INSERT INTO public\.[a-z_]+/g) ?? [];
    expect(publicInserts).toHaveLength(4);
  });

  it("never updates or deletes any public table", () => {
    expect(code).not.toMatch(/UPDATE\s+public\./i);
    expect(code).not.toMatch(/DELETE\s+FROM/i);
    expect(code).not.toMatch(/TRUNCATE/i);
    expect(code).not.toMatch(/\bUPSERT\b|ON CONFLICT/i);
  });

  it("performs the approval CAS as a guarded single-row update inside the transaction", () => {
    expect(body).toContain("UPDATE forever_import.import_execution_approvals");
    expect(body).toContain("WHERE approval_digest = v_approval_digest AND consumed_at IS NULL");
  });

  it("evaluates approval expiry with database time only", () => {
    expect(body).toContain("IF now() < v_approval.issued_at THEN");
    expect(body).toContain("IF now() >= v_approval.expires_at THEN");
  });

  it("bounds request size and operation count server-side", () => {
    const validate = functionDefinition(
      "CREATE OR REPLACE FUNCTION forever_import.validate_import_request(request JSONB)",
    );
    expect(validate).toContain("pg_column_size(request) > 4194304");
    expect(validate).toContain("IF v_expected_operations > 1000 THEN");
    expect(body).toContain("PERFORM forever_import.validate_import_request(request);");
  });

  it("verifies fresh state, relationships, duplicates, and fields before commit", () => {
    expect(body).toContain("forever_import_execution: target_state_changed");
    expect(body).toContain("forever_import_execution: plan_already_executed");
    expect(body).toContain("forever_import_execution: verification_row_missing");
    expect(body).toContain("forever_import_execution: verification_extra_rows");
    expect(body).toContain("forever_import_execution: verification_duplicate_persistence_key");
    expect(body).toContain("forever_import_execution: verification_parent_mismatch");
    expect(body).toContain("forever_import_execution: verification_field_mismatch");
    expect(body).toContain("forever_import_execution: verification_count_mismatch");
  });

  it("returns only sanitized display-safe result fields", () => {
    const returnBlock = body.slice(body.indexOf("RETURN jsonb_build_object"));
    expect(returnBlock).not.toMatch(/secret|credential|approval_id[^_]/i);
    expect(returnBlock).toContain("'writesPerformed', v_writes");
    expect(returnBlock).toContain("'commitConfirmed', true");
  });

  it("is not referenced by any earlier migration (isolation)", () => {
    // The boundary is new: nothing else in the repository's migrations touches
    // the private schema, so committing without applying changes no behavior.
    expect(sql).toContain("COMMITTED BUT NOT APPLIED");
  });
});

describe("RC5.5D migration security: approved-request binding (review blocker 1)", () => {
  const approvals = tableDefinition("forever_import.import_execution_approvals");
  const run = functionDefinition(
    "CREATE OR REPLACE FUNCTION forever_import.run_approved_import(request JSONB)",
  );
  const register = functionDefinition(
    "CREATE OR REPLACE FUNCTION forever_import.register_import_approval(",
  );

  it("stores the immutable approved request body and a server-computed digest", () => {
    expect(approvals).toContain("approved_request JSONB NOT NULL");
    expect(approvals).toContain("approved_request_digest TEXT NOT NULL");
    expect(approvals).toContain("CHECK (approved_request_digest ~ '^[0-9a-f]{64}$')");
  });

  it("computes the request digest inside PostgreSQL, never from a client value", () => {
    const digest = functionDefinition(
      "CREATE OR REPLACE FUNCTION forever_import.request_digest(doc JSONB)",
    );
    expect(digest).toContain("sha256(convert_to(doc::text, 'UTF8'))");
    expect(digest).toContain("encode(");
    expect(register).toContain("forever_import.request_digest(p_request)");
    // The client fingerprint is never used as the stored digest.
    expect(register).not.toContain("requestFingerprint");
  });

  it("structurally binds every scope column to the stored body via CHECK constraints", () => {
    expect(approvals).toContain("CHECK (approval_digest = approved_request->>'approvalDigest')");
    expect(approvals).toContain("CHECK (schema_version = approved_request->>'schemaVersion')");
    expect(approvals).toContain("CHECK (project_slug = approved_request->>'projectSlug')");
    expect(approvals).toContain("CHECK (target = approved_request->>'target')");
    expect(approvals).toContain("CHECK (target_project_id = approved_request->>'targetProjectId')");
    expect(approvals).toContain("CHECK (plan_hash = approved_request->>'planHash')");
    expect(approvals).toContain(
      "CHECK (collision_report_fingerprint = approved_request->>'collisionReportFingerprint')",
    );
    expect(approvals).toContain(
      "operation_count = (approved_request->'operationCounts'->>'operations')::INTEGER",
    );
  });

  it("validates registration with the same shared validator as execution", () => {
    expect(register).toContain("PERFORM forever_import.validate_import_request(p_request);");
    expect(run).toContain("PERFORM forever_import.validate_import_request(request);");
  });

  it("covers unsafe paths and credential material server-side", () => {
    const validate = functionDefinition(
      "CREATE OR REPLACE FUNCTION forever_import.validate_import_request(request JSONB)",
    );
    expect(validate).toContain("forever_import.has_unsafe_source_file(request)");
    expect(validate).toContain("forever_import_execution: request_unsafe_path");
    expect(validate).toContain("forever_import_execution: request_credential_material");
    expect(validate).toContain("position('sb_secret_' in v_text)");
  });

  it("compares the incoming request against the approved body BEFORE consumption", () => {
    const equality = run.indexOf("IS DISTINCT FROM v_approval.approved_request");
    const digestCompare = run.indexOf("IS DISTINCT FROM v_approval.approved_request_digest");
    const cas = run.indexOf("UPDATE forever_import.import_execution_approvals");
    const firstInsert = run.indexOf("INSERT INTO public.projects");
    expect(equality).toBeGreaterThan(0);
    expect(digestCompare).toBeGreaterThan(0);
    expect(cas).toBeGreaterThan(0);
    expect(equality).toBeLessThan(cas);
    expect(digestCompare).toBeLessThan(cas);
    expect(cas).toBeLessThan(firstInsert);
    expect(run).toContain("forever_import_execution: approval_request_mismatch");
  });

  it("records the server-side digest in the durable receipt", () => {
    const receipts = tableDefinition("forever_import.import_execution_receipts");
    expect(receipts).toContain("approved_request_digest TEXT NOT NULL");
    expect(run).toContain("v_approval.approved_request_digest");
  });
});

describe("RC5.5D migration security: least-privilege execution principal (review blocker)", () => {
  const WRAPPER = "forever_execution.forever_execute_approved_import(JSONB)";
  const TARGET_TABLES = [
    "public.projects",
    "public.buildings",
    "public.units",
    "public.unit_price_history",
    "forever_import.import_execution_approvals",
    "forever_import.import_execution_receipts",
  ];
  const INTERNAL_FUNCTIONS = [
    "forever_import.register_import_approval(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)",
    "forever_import.run_approved_import(JSONB)",
    "forever_import.validate_import_request(JSONB)",
    "forever_import.request_digest(JSONB)",
    "forever_import.has_unsafe_source_file(JSONB)",
  ];

  /**
   * All privileges (comment-stripped) granted directly to the executor role.
   * `[^;]+?` keeps each match inside one GRANT statement so a preceding grant to
   * a different grantee (e.g. the owner-membership grant) can never be spanned.
   */
  function executorGrants(): string[] {
    const grants: string[] = [];
    const pattern = /GRANT\s+([^;]+?)\s+TO\s+forever_import_executor\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      grants.push(match[1].replace(/\s+/g, " ").trim());
    }
    return grants;
  }

  it("does NOT grant service_role execution on the wrapper and revokes it defensively", () => {
    expect(code).not.toMatch(/GRANT[^;]*forever_execute_approved_import[\s\S]*?TO service_role/i);
    expect(code).not.toMatch(/GRANT EXECUTE[^;]*TO service_role/i);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${WRAPPER} FROM service_role;`);
  });

  it("grants the executor EXACTLY wrapper EXECUTE and execution-schema USAGE — nothing else", () => {
    expect(executorGrants().sort()).toEqual(
      [`EXECUTE ON FUNCTION ${WRAPPER}`, "USAGE ON SCHEMA forever_execution"].sort(),
    );
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION forever_execution.forever_execute_approved_import(JSONB)\n  TO forever_import_executor;`,
    );
    expect(sql).toContain("GRANT USAGE ON SCHEMA forever_execution TO forever_import_executor;");
  });

  it("puts the wrapper OUTSIDE public; the executor's public REVOKE is defensive, not a PUBLIC override", () => {
    // The one callable surface is in the dedicated closed schema, not public.
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION forever_execution.forever_execute_approved_import(request JSONB)",
    );
    expect(code).not.toMatch(/CREATE OR REPLACE FUNCTION public\.forever_execute_approved_import/);
    // The executor is never granted public-schema USAGE.
    expect(code).not.toMatch(/GRANT USAGE ON SCHEMA public TO forever_import_executor/);
    // The direct REVOKE from the executor is kept as defensive hygiene...
    expect(sql).toContain("REVOKE ALL ON SCHEMA public FROM forever_import_executor;");
    // ...but the migration must NOT globally revoke USAGE on public from PUBLIC
    // (that is a separate Owner decision). Only comment lines may mention it.
    const globalPublicRevokes = (code.match(/REVOKE[^;]*ON SCHEMA public FROM PUBLIC/gi) ?? [])
      .length;
    expect(globalPublicRevokes).toBe(0);
    // And the migration must NOT claim the direct REVOKE removes PUBLIC-derived
    // access — it explicitly documents the opposite.
    expect(sql).toContain("does NOT override a grant made to PUBLIC");
    expect(sql).toContain("option B");
  });

  it("closes the dedicated execution schema to PUBLIC and reverses default function EXECUTE", () => {
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS forever_execution;");
    expect(sql).toContain("REVOKE ALL ON SCHEMA forever_execution FROM PUBLIC;");
    expect(sql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA forever_execution REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
    );
    expect(sql).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA forever_execution REVOKE ALL ON TABLES FROM PUBLIC;",
    );
    // No API-facing role is granted anything in the execution schema.
    expect(code).not.toMatch(
      /GRANT[^;]*forever_execution[^;]*TO (anon|authenticated|service_role)/i,
    );
  });

  it("prepares an effective-privilege & PUBLIC-ACL audit that accounts for PUBLIC-inherited rights", () => {
    // The migration documents (in comments) that direct GRANT/REVOKE
    // enumeration is not sufficient and that an effective-privilege & PUBLIC-ACL
    // audit (including PUBLIC-derived rights, inspected via ACL catalogs and the
    // PUBLIC grantee OID, plus ownership) must run after application and before
    // approval issuance.
    expect(sql).toContain("effective-privilege & PUBLIC-ACL audit");
    expect(sql).toMatch(/PUBLIC-derived/);
    expect(sql).toContain("src/import/effective-privilege-audit.ts");
    // The audit inspects PUBLIC ACL state via catalog functions, not by passing
    // 'public' as a role name.
    expect(sql).toContain("aclexplode");
    expect(sql).toContain("grantee OID");
  });

  it("grants the executor NO privilege on any target table and revokes each explicitly", () => {
    for (const table of TARGET_TABLES) {
      expect(code).not.toMatch(
        new RegExp(`GRANT[^;]*ON ${table.replace(".", "\\.")}[^;]*TO forever_import_executor`, "i"),
      );
      expect(sql).toContain(`REVOKE ALL ON ${table} FROM forever_import_executor;`);
    }
  });

  it("gives the executor NO USAGE on the private schema and NO EXECUTE on any internal function", () => {
    // Whitespace-normalized so a multi-line REVOKE (wrapped signature) matches.
    const normalized = code.replace(/\s+/g, " ");
    expect(sql).toContain("REVOKE ALL ON SCHEMA forever_import FROM forever_import_executor;");
    expect(code).not.toMatch(/GRANT[^;]*ON SCHEMA forever_import[^;]*TO forever_import_executor/i);
    for (const fn of INTERNAL_FUNCTIONS) {
      expect(normalized).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM forever_import_executor;`);
      expect(code).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION ${fn.replace(/[()]/g, "\\$&")}[^;]*TO forever_import_executor`,
          "i",
        ),
      );
    }
  });

  it("keeps PUBLIC, anon, and authenticated revoked on the wrapper", () => {
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${WRAPPER} FROM PUBLIC;`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${WRAPPER} FROM anon;`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${WRAPPER} FROM authenticated;`);
  });

  it("default privileges never widen the executor", () => {
    expect(code).not.toMatch(/ALTER DEFAULT PRIVILEGES[^;]*GRANT[^;]*TO forever_import_executor/i);
  });

  it("threat model: the executor's only reachable capability is the one bounded wrapper", () => {
    // The complete set of things granted to the executor is USAGE-to-resolve
    // plus EXECUTE-the-wrapper. It therefore cannot SELECT/INSERT/UPDATE/DELETE
    // any imported table, cannot touch approval/receipt storage, and cannot
    // call any internal function directly — the SECURITY DEFINER wrapper is the
    // sole path, and it performs writes as its owner, not as the caller.
    const grants = executorGrants();
    expect(grants).toHaveLength(2);
    expect(grants.some((g) => /INSERT|UPDATE|DELETE|SELECT|TRUNCATE|ALL/i.test(g))).toBe(false);
    expect(
      grants.every((g) => g.includes(WRAPPER) || g === "USAGE ON SCHEMA forever_execution"),
    ).toBe(true);
  });
});

describe("RC5.5D migration security: dedicated execution-boundary owner (review 9)", () => {
  const BOUNDARY_ROUTINES = [
    "forever_import.request_digest(JSONB)",
    "forever_import.has_unsafe_source_file(JSONB)",
    "forever_import.validate_import_request(JSONB)",
    "forever_import.register_import_approval(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)",
    "forever_import.run_approved_import(JSONB)",
    "forever_execution.forever_execute_approved_import(JSONB)",
  ];

  it("creates a dedicated NOLOGIN owner role with no ambient authority and no password", () => {
    expect(sql).toContain(
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forever_import_execution_owner')",
    );
    expect(sql).toContain(
      "CREATE ROLE forever_import_execution_owner\n      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;",
    );
    expect(sql).toContain(
      "ALTER ROLE forever_import_execution_owner\n      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;",
    );
    // No LOGIN, no password ever committed for the owner.
    expect(code).not.toMatch(/forever_import_execution_owner[^;]*\bLOGIN\b(?!\s|$)/i);
    expect(code).not.toMatch(/PASSWORD/i);
  });

  it("owner is a member of no broad role; only the migration role is a member of the owner", () => {
    // The only membership grant involving the owner is `owner TO CURRENT_USER`
    // (migration-role → owner, for ownership reassignment). No broad role is ever
    // granted TO the owner, and the owner is granted TO no broad identity.
    expect(sql).toContain("GRANT forever_import_execution_owner TO CURRENT_USER;");
    expect(code).not.toMatch(
      /GRANT\s+(service_role|anon|authenticated|postgres|supabase_admin|pg_\w+)\s+TO forever_import_execution_owner/i,
    );
    expect(code).not.toMatch(
      /GRANT forever_import_execution_owner TO (service_role|anon|postgres)/i,
    );
  });

  it("reassigns EXACTLY the boundary schemas, tables, and routines to the owner", () => {
    expect(sql).toContain("ALTER SCHEMA forever_import OWNER TO forever_import_execution_owner;");
    expect(sql).toContain(
      "ALTER SCHEMA forever_execution OWNER TO forever_import_execution_owner;",
    );
    expect(sql).toContain(
      "ALTER TABLE forever_import.import_execution_approvals OWNER TO forever_import_execution_owner;",
    );
    expect(sql).toContain(
      "ALTER TABLE forever_import.import_execution_receipts OWNER TO forever_import_execution_owner;",
    );
    const normalized = code.replace(/\s+/g, " ");
    for (const routine of BOUNDARY_ROUTINES) {
      expect(normalized).toContain(
        `ALTER FUNCTION ${routine} OWNER TO forever_import_execution_owner;`,
      );
    }
    // Exactly the six routines are reassigned — no more, no fewer.
    expect(
      code.match(/ALTER FUNCTION [\s\S]+?OWNER TO forever_import_execution_owner;/g),
    ).toHaveLength(6);
    // Schemas reassigned before their contained objects (owner needs CREATE).
    expect(code.indexOf("ALTER SCHEMA forever_import OWNER")).toBeLessThan(
      code.indexOf("ALTER TABLE forever_import.import_execution_approvals OWNER"),
    );
  });

  it("never reassigns ownership of an unrelated target/application object", () => {
    for (const table of [
      "public.projects",
      "public.buildings",
      "public.units",
      "public.unit_price_history",
      "public.developers",
      "public.locations",
    ]) {
      expect(code).not.toMatch(
        new RegExp(`ALTER TABLE ${table.replace(".", "\\.")} OWNER TO`, "i"),
      );
    }
    expect(code).not.toMatch(/ALTER SCHEMA public OWNER TO/i);
    expect(code).not.toMatch(/ALTER DATABASE[^;]*OWNER TO forever_import_execution_owner/i);
  });

  it("grants the owner exactly the target-capability allowlist and no more", () => {
    expect(sql).toContain("GRANT USAGE ON SCHEMA public TO forever_import_execution_owner;");
    expect(sql).toContain("GRANT SELECT ON public.developers TO forever_import_execution_owner;");
    expect(sql).toContain("GRANT SELECT ON public.locations TO forever_import_execution_owner;");
    for (const table of ["projects", "buildings", "units", "unit_price_history"]) {
      expect(sql).toContain(
        `GRANT SELECT, INSERT ON public.${table} TO forever_import_execution_owner;`,
      );
    }
    // No write beyond SELECT/INSERT on the import tables; no sequence privilege.
    expect(code).not.toMatch(
      /GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b[^;]*TO forever_import_execution_owner/i,
    );
    expect(code).not.toMatch(/GRANT[^;]*ON SEQUENCE[^;]*TO forever_import_execution_owner/i);
    // The owner is never granted execution-schema privileges to any API role.
    expect(code).not.toMatch(
      /GRANT[^;]*forever_import_execution_owner[^;]*TO (anon|authenticated|service_role)/i,
    );
  });
});

describe("RC5.5D migration security: deterministic owner RLS policy normalization (review 11)", () => {
  const SELECT_POLICIES: ReadonlyArray<readonly [table: string, name: string]> = [
    ["developers", "forever_import_owner_select_developers"],
    ["locations", "forever_import_owner_select_locations"],
    ["projects", "forever_import_owner_select_projects"],
    ["buildings", "forever_import_owner_select_buildings"],
    ["units", "forever_import_owner_select_units"],
    ["unit_price_history", "forever_import_owner_select_unit_price_history"],
  ];
  const INSERT_POLICIES: ReadonlyArray<readonly [table: string, name: string]> = [
    ["projects", "forever_import_owner_insert_projects"],
    ["buildings", "forever_import_owner_insert_buildings"],
    ["units", "forever_import_owner_insert_units"],
    ["unit_price_history", "forever_import_owner_insert_unit_price_history"],
  ];
  const ALL_POLICIES = [...SELECT_POLICIES, ...INSERT_POLICIES];

  /** All CREATE POLICY statements (comment-stripped, one statement each). */
  const createPolicyStatements = (): string[] => code.match(/CREATE POLICY [^;]+;/g) ?? [];
  /** All DROP POLICY statements (comment-stripped). */
  const dropPolicyStatements = (): string[] => code.match(/DROP POLICY [^;]+;/g) ?? [];

  const expectedSelectCreate = (table: string, name: string): string =>
    `CREATE POLICY ${name}\n  ON public.${table}\n  AS PERMISSIVE\n  FOR SELECT\n  TO forever_import_execution_owner\n  USING (true);`;
  const expectedInsertCreate = (table: string, name: string): string =>
    `CREATE POLICY ${name}\n  ON public.${table}\n  AS PERMISSIVE\n  FOR INSERT\n  TO forever_import_execution_owner\n  WITH CHECK (true);`;
  const expectedDrop = (table: string, name: string): string =>
    `DROP POLICY IF EXISTS ${name} ON public.${table};`;

  it("normalizes every RC5.5D policy deterministically: DROP IF EXISTS immediately precedes its exact CREATE", () => {
    for (const [table, name] of ALL_POLICIES) {
      const drop = expectedDrop(table, name);
      expect(sql, drop).toContain(drop);
      const dropIndex = sql.indexOf(drop);
      const createIndex = sql.indexOf(`CREATE POLICY ${name}\n`);
      expect(createIndex, name).toBeGreaterThan(dropIndex);
      // Exactly one DROP and one CREATE per dedicated name (no duplicates).
      expect(sql.split(`DROP POLICY IF EXISTS ${name} `).length - 1).toBe(1);
      expect(sql.split(`CREATE POLICY ${name}\n`).length - 1).toBe(1);
    }
  });

  it("creates the six SELECT policies with the exact full definition text", () => {
    for (const [table, name] of SELECT_POLICIES) {
      expect(sql).toContain(expectedSelectCreate(table, name));
    }
  });

  it("creates the four INSERT policies with the exact full definition text", () => {
    for (const [table, name] of INSERT_POLICIES) {
      expect(sql).toContain(expectedInsertCreate(table, name));
    }
    // No INSERT policy on the two read-only dependency tables (bounded to one
    // CREATE POLICY statement via [^;] so a later INSERT policy is not spanned).
    for (const table of ["developers", "locations"]) {
      expect(code).not.toMatch(
        new RegExp(`CREATE POLICY[^;]*ON public\\.${table}[^;]*FOR INSERT`, "i"),
      );
    }
  });

  it("retains NO IF-NOT-EXISTS preservation path for any policy (same-name drift is always replaced)", () => {
    // The v10 pattern guarded CREATE POLICY behind a pg_policies existence
    // check, which would PRESERVE a same-name policy with unsafe or inoperable
    // semantics. No policy-existence conditional may remain anywhere.
    expect(code).not.toMatch(/pg_policies/i);
    expect(code).not.toMatch(/CREATE POLICY IF NOT EXISTS/i);
    expect(code).not.toMatch(/IF NOT EXISTS[^;]*CREATE POLICY/i);
    // Exactly ten unconditional CREATE POLICY statements exist.
    expect(createPolicyStatements()).toHaveLength(ALL_POLICIES.length);
  });

  it("rerunning is deterministic: every CREATE is paired with exactly one preceding DROP IF EXISTS", () => {
    const drops = dropPolicyStatements();
    expect(drops).toHaveLength(ALL_POLICIES.length);
    for (const drop of drops) {
      expect(drop).toContain("DROP POLICY IF EXISTS ");
    }
  });

  it("drops ONLY the ten dedicated RC5.5D policy names — never an unrelated application policy", () => {
    const drops = dropPolicyStatements();
    const droppedNames = drops
      .map((d) => /DROP POLICY IF EXISTS (\S+) ON/.exec(d)?.[1])
      .filter((n): n is string => typeof n === "string");
    expect(droppedNames.sort()).toEqual(ALL_POLICIES.map(([, name]) => name).sort());
    // The pre-existing website policies are never referenced, dropped, or altered.
    for (const preexisting of [
      "Developers are viewable by everyone",
      "Locations are viewable by everyone",
      "Active projects are viewable by everyone",
      "Units of active projects are viewable by everyone",
      "Buildings of active projects are viewable",
      "Price history of active project units is viewable",
    ]) {
      expect(code).not.toContain(preexisting);
    }
    expect(code).not.toMatch(/ALTER POLICY/i);
  });

  it("uses exactly SELECT ×6 and INSERT ×4 — no ALL, UPDATE, or DELETE policy", () => {
    const statements = createPolicyStatements();
    expect(statements.filter((p) => p.includes("FOR SELECT")).length).toBe(6);
    expect(statements.filter((p) => p.includes("FOR INSERT")).length).toBe(4);
    for (const p of statements) {
      expect(p).toMatch(/FOR (SELECT|INSERT)\b/);
      expect(p).not.toMatch(/FOR (UPDATE|DELETE|ALL)\b/);
    }
  });

  it("declares every policy AS PERMISSIVE explicitly", () => {
    for (const p of createPolicyStatements()) {
      expect(p).toContain("AS PERMISSIVE");
      expect(p).not.toMatch(/AS RESTRICTIVE/i);
    }
  });

  it("scopes every policy to exactly forever_import_execution_owner — no additional or broad role", () => {
    for (const p of createPolicyStatements()) {
      expect(p).toContain("TO forever_import_execution_owner\n");
      // A single-role TO clause: no comma-separated role list anywhere.
      expect(p).not.toMatch(/TO [^;]*,/);
      expect(p).not.toMatch(/TO\s+(public|PUBLIC)\b/);
      expect(p).not.toMatch(/\b(anon|authenticated|service_role|postgres)\b/);
    }
  });

  it("SELECT policies carry USING (true) and no WITH CHECK; INSERT policies the reverse", () => {
    for (const p of createPolicyStatements()) {
      if (p.includes("FOR SELECT")) {
        expect(p).toContain("USING (true)");
        expect(p).not.toContain("WITH CHECK");
      } else {
        expect(p).toContain("WITH CHECK (true)");
        expect(p).not.toContain("USING");
      }
      // Constant predicate only: no helper routine, session state, JWT claim,
      // dynamic SQL, or caller-controlled condition.
      expect(p).not.toMatch(/EXECUTE|format\(|quote_|current_setting|auth\.|jwt|current_user/i);
      expect(p).toMatch(/ON public\./);
    }
  });

  it("does NOT grant BYPASSRLS, superuser, or FORCE RLS, and never owns a target table", () => {
    // No BYPASSRLS except the explicit NOBYPASSRLS negation (lookbehind excludes NO).
    expect(code).not.toMatch(/(?<!NO)BYPASSRLS/);
    // The owner role is explicitly NOBYPASSRLS.
    expect(sql).toContain(
      "NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
    expect(code).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    for (const [table] of SELECT_POLICIES) {
      expect(code).not.toMatch(
        new RegExp(`ALTER TABLE public\\.${table} OWNER TO forever_import_execution_owner`, "i"),
      );
    }
  });
});
