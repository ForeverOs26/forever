/**
 * RC5.5D effective-privilege, PUBLIC-ACL, execution-chain & schema-classification
 * audit contract (PREPARATION ONLY — never run against a real database in this
 * task).
 *
 * Why direct GRANT/REVOKE enumeration is NOT a proof of least privilege:
 * in PostgreSQL a role's EFFECTIVE privileges are the UNION of its direct
 * grants, the grants of every role it inherits, and the grants made to the
 * implicit `PUBLIC` pseudo-group (of which EVERY role is implicitly a member).
 * A stock database commonly carries `GRANT USAGE ON SCHEMA public TO PUBLIC`
 * and grants `EXECUTE` on routines to PUBLIC by default, so a direct
 * `REVOKE ... FROM forever_import_executor` does NOT remove a privilege the
 * role holds *through PUBLIC*. The committed migration's direct revokes are
 * defensive hygiene only; the actual effective access of the executor is
 * determined ONLY by this audit against the real target.
 *
 * Whole-surface coverage: this audit evaluates the ENTIRE non-system database
 * surface, not a fixed short list of schemas. System schemas are excluded ONLY
 * by the explicit allowlist / pattern in {@link SYSTEM_SCHEMA_EXACT} /
 * {@link SYSTEM_SCHEMA_PREFIXES} (see {@link isSystemSchema}); every other
 * schema is audited. A deceptive name such as `pg_catalog_evil` is NOT excluded.
 *
 * Three additional guarantees (Review 8):
 *
 *   1. ANY routine, not only SECURITY DEFINER: the executor must hold EXECUTE on
 *      NO routine anywhere except exactly the wrapper. The routine check spans
 *      functions, procedures, aggregates, and window functions (`pg_proc`
 *      `prokind IN ('f','p','a','w')`), SECURITY DEFINER and SECURITY INVOKER
 *      alike, overloaded and extension routines included, across every
 *      non-system schema.
 *
 *   2. Complete execution chain: the wrapper is SECURITY DEFINER, so calling it
 *      runs as its OWNER, and the internal routines it calls run in that same
 *      definer context. The audit therefore classifies the SECURITY DEFINER
 *      transition target — the wrapper owner — and the internal-routine owners,
 *      and fails closed if any is a superuser, holds BYPASSRLS, is a known broad
 *      platform role ({@link BROAD_PLATFORM_ROLES}), or is a member of such a
 *      role. It also confirms the executor is a dedicated LOGIN role with no
 *      ambient authority and no membership / SET ROLE path.
 *
 *   3. Explicit schema classification: every non-system schema is classified as
 *      exactly one of `approved_required_surface`, `explicitly_prohibited_surface`,
 *      or `unexpected_surface` (see {@link classifySchema}). A schema that is
 *      neither approved nor explicitly prohibited is `unexpected_surface` and
 *      BLOCKS readiness until the Owner explicitly classifies it — a newly
 *      introduced schema can never silently pass.
 *
 * Review 9 binds the execution chain to one EXACT dedicated owner. The wrapper
 * and every internal routine are owned by {@link EXECUTION_OWNER_ROLE}
 * (`forever_import_execution_owner`, NOLOGIN, minimal flags), so the audit
 * proves — deterministically, not against a denylist — the exact owner identity
 * ({@link BOUNDARY_ROUTINES} / {@link BOUNDARY_RELATIONS} / {@link BOUNDARY_SEQUENCES}
 * inventories), the owner's role shape, its empty (direct + recursive) membership
 * and SET ROLE closure, that it owns nothing outside the approved boundary, and
 * that its effective capabilities reduce to the exact target allowlist
 * ({@link OWNER_TARGET_RELATION_PRIVILEGES}). The v8 "not broad" chain checks are
 * retained as a weaker complementary signal.
 *
 * Review 11 makes the RLS policy state deterministic and proves its EXACT
 * runtime definition. The migration normalizes every RC5.5D-owned policy with
 * `DROP POLICY IF EXISTS` + `CREATE POLICY` (never `IF NOT EXISTS`, which
 * would preserve a same-name policy with drifted semantics), and the audit
 * proves — for each of the ten policies in {@link REQUIRED_RLS_POLICIES} —
 * the exact name, exact table, exact command, `polpermissive = true`, the
 * exact role set `polroles = {owner OID}` (array equality, never "owner OID
 * appears somewhere"), and the exact constant-true `USING` / `WITH CHECK`
 * expressions via `pg_get_expr` under a tight normalization
 * ({@link normalizePolicyExpression}). PUBLIC applicability is handled
 * explicitly: a policy `TO PUBLIC` stores `polroles = {0}` — PUBLIC is a
 * pseudo-group, not a `pg_roles` row, so a `pg_roles` join can never see it —
 * and applies to EVERY role including the owner. Every policy on the six
 * target tables that applies to the owner (owner OID, PUBLIC OID 0, or any
 * transitive membership) is classified as exactly one of
 * `required_execution_policy` / `approved_preexisting_read_policy` /
 * `unexpected_policy` ({@link classifyTargetTablePolicy}); the six
 * pre-existing PUBLIC website SELECT policies are individually enumerated
 * with their complete expected definitions in
 * {@link APPROVED_PREEXISTING_READ_POLICIES} (they are permissive SELECT-only
 * and cannot widen the owner's audited access or block it), and ANY other
 * applicable policy — or any definition drift in a known one — blocks
 * readiness. Applicable restrictive policies, applicable UPDATE/DELETE/ALL
 * policies, and PUBLIC write policies are each independently fatal.
 *
 * Two distinct catalog techniques, used correctly:
 *
 *   1. The EXECUTOR's effective privileges — direct + inherited + PUBLIC —
 *      are measured with `has_*_privilege(role_oid, object_oid, priv)`. Those
 *      functions fold in PUBLIC and inheritance. The role and object are ALWAYS
 *      resolved to OIDs through a join (never a bare name literal), so a missing
 *      role or object yields no row and the check fails closed instead of
 *      raising.
 *
 *   2. The ACL granted specifically to PUBLIC is inspected through the ACL
 *      catalogs (`pg_namespace.nspacl`, `pg_proc.proacl`) expanded with
 *      `aclexplode` over `COALESCE(<acl>, acldefault(type, owner))`, matching
 *      the PUBLIC grantee by its OID `0`. `PUBLIC` is a pseudo-group, NOT an
 *      ordinary `pg_roles` role: it is NEVER passed as a role-name argument to
 *      `has_*_privilege`.
 *
 * Option B: any PUBLIC-derived / ambient capability that a stock target commonly
 * grants (public-schema USAGE, database TEMP, an executor-reachable routine, a
 * broad wrapper owner, an unexpected schema) is classified
 * `blocking_unless_reconciled`: it BLOCKS readiness and is surfaced explicitly
 * so the Owner performs a separate target reconciliation before the first
 * supervised permanent import. Wrapper isolation relies on the closed
 * `forever_execution` schema, which is the primary isolation boundary.
 *
 * This module opens no connection and issues no query in this slice. It is a
 * pure, testable contract: {@link EFFECTIVE_PRIVILEGE_AUDIT} defines exactly
 * what a FUTURE migration-application checkpoint must run (read-only, AFTER the
 * migration is applied and BEFORE any approval is issued), and
 * {@link evaluateEffectivePrivilegeAudit} scores an observed result set without
 * any I/O.
 */

export const EXECUTOR_ROLE = "forever_import_executor" as const;
export const EXECUTION_SCHEMA = "forever_execution" as const;
export const PRIVATE_SCHEMA = "forever_import" as const;
export const EXECUTION_WRAPPER_SIGNATURE =
  "forever_execution.forever_execute_approved_import(jsonb)" as const;
export const EXECUTION_WRAPPER_NAME = "forever_execute_approved_import" as const;
export const EXECUTION_WRAPPER_ARGS = "request jsonb" as const;

/**
 * Explicit system-schema exclusion policy. ONLY these schemas are treated as
 * PostgreSQL system schemas and excluded from the non-system-surface audit.
 * Everything else — including every Supabase-managed schema and any
 * application/extension schema — is audited as non-system.
 *
 * `SYSTEM_SCHEMA_EXACT` are matched by exact name; `SYSTEM_SCHEMA_PREFIXES` as
 * literal-underscore name prefixes (session-local temp and temp-toast schemas).
 * A deceptive name such as `pg_catalog_evil` matches NEITHER and is audited.
 */
export const SYSTEM_SCHEMA_EXACT: readonly string[] = Object.freeze([
  "pg_catalog",
  "information_schema",
  "pg_toast",
]);
export const SYSTEM_SCHEMA_PREFIXES: readonly string[] = Object.freeze([
  "pg_temp_",
  "pg_toast_temp_",
  "pg_toast_",
]);

/** True only for an explicitly-allowlisted PostgreSQL system schema. */
export function isSystemSchema(name: string): boolean {
  if (SYSTEM_SCHEMA_EXACT.includes(name)) return true;
  return SYSTEM_SCHEMA_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** True for every schema that must be audited (everything not a system schema). */
export function isNonSystemSchema(name: string): boolean {
  return !isSystemSchema(name);
}

/**
 * Explicit classification of every non-system schema (Review 8, blocker 3).
 * A schema is exactly one of these. `unexpected_surface` blocks readiness until
 * the Owner explicitly classifies it, so a newly introduced schema can never
 * silently pass.
 */
export type SchemaClassification =
  | "system"
  | "approved_required_surface"
  | "explicitly_prohibited_surface"
  | "unexpected_surface";

/** Non-system schemas the executor legitimately needs (USAGE + wrapper EXECUTE). */
export const APPROVED_REQUIRED_SCHEMAS: readonly string[] = Object.freeze(["forever_execution"]);

/**
 * Non-system schemas that are known and explicitly prohibited to the executor
 * (the private storage, the option-B public schema, and the well-known
 * Supabase-managed schemas). The executor must hold NO effective privilege in
 * any of these; the whole-surface checks enforce that. Listing them here means
 * they are "explicitly classified" rather than "unexpected".
 */
export const EXPLICITLY_PROHIBITED_SCHEMAS: readonly string[] = Object.freeze([
  "public",
  "forever_import",
  "auth",
  "storage",
  "extensions",
  "graphql",
  "graphql_public",
  "realtime",
  "_realtime",
  "vault",
  "pgsodium",
  "pgsodium_masks",
  "supabase_functions",
  "supabase_migrations",
  "net",
  "cron",
  "_analytics",
  "pgbouncer",
]);

/** Classify a schema into exactly one {@link SchemaClassification}. */
export function classifySchema(name: string): SchemaClassification {
  if (isSystemSchema(name)) return "system";
  if (APPROVED_REQUIRED_SCHEMAS.includes(name)) return "approved_required_surface";
  if (EXPLICITLY_PROHIBITED_SCHEMAS.includes(name)) return "explicitly_prohibited_surface";
  return "unexpected_surface";
}

/**
 * Broad / dangerous platform roles that must NOT own the SECURITY DEFINER
 * wrapper or the internal routines it calls (Review 8, blocker 2). A wrapper
 * owned by a superuser or a broad platform role means the SECURITY DEFINER
 * transition escalates the bounded import into that role's authority. Superuser
 * and BYPASSRLS are detected dynamically from `pg_roles`; these names cover the
 * common Supabase/PostgreSQL platform roles and predefined groups.
 */
export const BROAD_PLATFORM_ROLES: readonly string[] = Object.freeze([
  "postgres",
  "service_role",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "supabase_read_only_user",
  "supabase_replication_admin",
  "supabase_realtime_admin",
  "authenticator",
  "pg_read_all_data",
  "pg_write_all_data",
  "pg_monitor",
  "pg_database_owner",
  "rds_superuser",
  "rdsadmin",
]);

/** True for a known broad/dangerous platform role name. */
export function isBroadPlatformRole(name: string): boolean {
  return BROAD_PLATFORM_ROLES.includes(name);
}

/**
 * Public-schema USAGE / ambient-PUBLIC policy for the first supervised import.
 * `blocking` = option B: a PUBLIC-derived public-schema USAGE (or comparable
 * ambient PUBLIC capability) blocks readiness and requires a separate
 * Owner-approved target-ACL reconciliation. Never silently assumed absent.
 */
export const PUBLIC_SCHEMA_USAGE_POLICY = "blocking" as const;

/**
 * Classification of a check's expected effective privilege.
 * - `required`: the executor MUST have this (the two legitimate capabilities,
 *   plus the two existence anchors).
 * - `must_be_absent`: a genuine least-privilege leak / wrong shape that should
 *   never occur on a correctly-migrated target (direct or PUBLIC-derived),
 *   including one in ANY non-system schema.
 * - `blocking_unless_reconciled`: a PUBLIC-derived / ambient capability or
 *   execution-chain condition that a STOCK target commonly presents
 *   (public-schema USAGE, database TEMP, an executor-reachable routine, a broad
 *   wrapper owner, an unexpected schema). It BLOCKS readiness exactly like
 *   `must_be_absent`, but is surfaced separately because clearing it is a
 *   distinct Owner-approved reconciliation, not a migration bug.
 * - `required_capability`: a POSITIVE operability requirement — the execution
 *   owner MUST actually hold this effective privilege for the bounded import to
 *   run. A violation is a missing-required-capability failure (the boundary is
 *   safe but INOPERABLE), never a reconciliation item (Review 10, blocker 1/5).
 * - `rls_requirement`: a Row-Level-Security operability requirement — the exact
 *   owner-scoped policy / RLS state the bounded import needs to SELECT and INSERT
 *   under RLS without BYPASSRLS. A violation is an RLS-incompatibility failure
 *   (Review 10, blocker 4/5).
 */
export type PrivilegeClassification =
  | "required"
  | "required_capability"
  | "rls_requirement"
  | "must_be_absent"
  | "blocking_unless_reconciled";

export interface EffectivePrivilegeCheck {
  /** Stable identifier, also the key in the observed-results map. */
  name: string;
  classification: PrivilegeClassification;
  /**
   * A single read-only SQL statement returning exactly one boolean column
   * `ok`. `ok = true` means the check passed. Uses only SELECT and
   * catalog/privilege/ACL functions — no mutation, DDL, GRANT, or REVOKE.
   * Every check resolves role and object to OIDs and folds NULL ACLs through
   * `acldefault`, so a missing role/object or NULL ACL column fails closed
   * (or is observed correctly) instead of raising.
   */
  sql: string;
  /** Human-readable statement of what `ok = true` proves. */
  rationale: string;
}

const q = (sql: string): string => sql.replace(/\s+/g, " ").trim();

/** Resolves the executor role to a single `pg_roles` row aliased `r`. */
const ROLE = `pg_catalog.pg_roles r`;
const ROLE_WHERE = `r.rolname = '${EXECUTOR_ROLE}'`;

/** Wrapper-identity predicate against a `pg_proc p` / `pg_namespace n` join. */
const WRAPPER_PREDICATE = `
  n.nspname = '${EXECUTION_SCHEMA}'
  AND p.proname = '${EXECUTION_WRAPPER_NAME}'
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '${EXECUTION_WRAPPER_ARGS}'
`;

/**
 * SQL predicate selecting NON-system schemas for a `pg_namespace` alias, derived
 * from {@link SYSTEM_SCHEMA_EXACT} / {@link SYSTEM_SCHEMA_PREFIXES} so the SQL and
 * {@link isSystemSchema} cannot drift. Exact names via `NOT IN`; prefixes via
 * anchored POSIX regex (`~ '^prefix'`, `_` literal). `pg_catalog_evil` matches
 * none of these and is therefore audited.
 */
function nonSystemSchemaPredicate(alias: string): string {
  const exact = SYSTEM_SCHEMA_EXACT.map((s) => `'${s}'`).join(", ");
  const notPrefixes = SYSTEM_SCHEMA_PREFIXES.map((p) => `${alias}.nspname !~ '^${p}'`).join(
    "\n      AND ",
  );
  return `${alias}.nspname NOT IN (${exact})\n      AND ${notPrefixes}`;
}

const NON_SYSTEM_N = nonSystemSchemaPredicate("n");

const BROAD_ROLES_SQL = BROAD_PLATFORM_ROLES.map((s) => `'${s}'`).join(", ");
const APPROVED_AND_PROHIBITED_SQL = [...APPROVED_REQUIRED_SCHEMAS, ...EXPLICITLY_PROHIBITED_SCHEMAS]
  .map((s) => `'${s}'`)
  .join(", ");

/**
 * SQL predicate (for a `pg_roles` alias) that is TRUE when the role is a broad
 * or dangerous owner: a superuser, a BYPASSRLS holder, a known broad platform
 * role, or a direct member of a superuser / broad platform role.
 */
function ownerIsBroad(alias: string): string {
  return `(
        ${alias}.rolsuper
        OR ${alias}.rolbypassrls
        OR ${alias}.rolname IN (${BROAD_ROLES_SQL})
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.pg_auth_members mm
          JOIN pg_catalog.pg_roles gg ON gg.oid = mm.roleid
          WHERE mm.member = ${alias}.oid
            AND (gg.rolsuper OR gg.rolname IN (${BROAD_ROLES_SQL}))
        )
      )`;
}

// ---------------------------------------------------------------------------
// Dedicated execution-boundary OWNER (Review 9)
// ---------------------------------------------------------------------------
// The SECURITY DEFINER wrapper runs as its OWNER, and the internal routines it
// calls run in that same definer context, so the whole execution chain's real
// authority is the wrapper owner. RC5.5D binds that to one exact dedicated
// NOLOGIN role. The audit proves the exact owner identity, role shape, ownership
// inventory, membership/SET ROLE closure, and effective-capability allowlist —
// not merely that the owner "is not on a denylist".

export const EXECUTION_OWNER_ROLE = "forever_import_execution_owner" as const;

const OWNER = `pg_catalog.pg_roles ow`;
const OWNER_WHERE = `ow.rolname = '${EXECUTION_OWNER_ROLE}'`;

/** The two boundary schemas the execution owner owns. */
export const BOUNDARY_OWNED_SCHEMAS: readonly string[] = Object.freeze([
  PRIVATE_SCHEMA,
  EXECUTION_SCHEMA,
]);
const BOUNDARY_SCHEMAS_SQL = BOUNDARY_OWNED_SCHEMAS.map((s) => `'${s}'`).join(", ");

export interface BoundaryRoutine {
  schema: string;
  name: string;
  /** As `pg_get_function_identity_arguments` renders it. */
  identityArgs: string;
  /** `pg_proc.prokind`: 'f' function, 'p' procedure, 'a' aggregate, 'w' window. */
  prokind: string;
  securityDefiner: boolean;
  purpose: string;
}

/** The EXACT routine inventory the RC5.5D boundary schemas must contain. */
export const BOUNDARY_ROUTINES: readonly BoundaryRoutine[] = Object.freeze([
  {
    schema: "forever_execution",
    name: "forever_execute_approved_import",
    identityArgs: "request jsonb",
    prokind: "f",
    securityDefiner: true,
    purpose: "external wrapper (the only executor-callable surface)",
  },
  {
    schema: "forever_import",
    name: "run_approved_import",
    identityArgs: "request jsonb",
    prokind: "f",
    securityDefiner: false,
    purpose: "internal atomic execution routine",
  },
  {
    schema: "forever_import",
    name: "validate_import_request",
    identityArgs: "request jsonb",
    prokind: "f",
    securityDefiner: false,
    purpose: "shared server-side request validator",
  },
  {
    schema: "forever_import",
    name: "request_digest",
    identityArgs: "doc jsonb",
    prokind: "f",
    securityDefiner: false,
    purpose: "canonicalization / SHA-256 digest",
  },
  {
    schema: "forever_import",
    name: "has_unsafe_source_file",
    identityArgs: "doc jsonb",
    prokind: "f",
    securityDefiner: false,
    purpose: "unsafe-source-path detector",
  },
  {
    schema: "forever_import",
    name: "register_import_approval",
    identityArgs:
      "p_issued_at timestamp with time zone, p_expires_at timestamp with time zone, p_request jsonb",
    prokind: "f",
    securityDefiner: false,
    purpose: "approval registration (granted to NO role; not executor-reachable)",
  },
]);

/** The EXACT relations (tables) the execution owner must own. */
export const BOUNDARY_RELATIONS: readonly { schema: string; name: string }[] = Object.freeze([
  { schema: "forever_import", name: "import_execution_approvals" },
  { schema: "forever_import", name: "import_execution_receipts" },
]);

/**
 * The EXACT boundary sequences. RC5.5D creates NONE — both durable tables use
 * UUID primary keys (`gen_random_uuid()`), and every target table likewise uses
 * a UUID key, so no sequence participates in any insert.
 */
export const BOUNDARY_SEQUENCES: readonly { schema: string; name: string }[] = Object.freeze([]);

/**
 * The EXACT target-object capability allowlist for the execution owner: existing
 * relations the owner may ACCESS (but must not own) and the precise privileges
 * it may hold on each. No UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, no sequence
 * privilege.
 */
export const OWNER_TARGET_RELATION_PRIVILEGES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "public.developers": Object.freeze(["SELECT"]),
    "public.locations": Object.freeze(["SELECT"]),
    "public.projects": Object.freeze(["SELECT", "INSERT"]),
    "public.buildings": Object.freeze(["SELECT", "INSERT"]),
    "public.units": Object.freeze(["SELECT", "INSERT"]),
    "public.unit_price_history": Object.freeze(["SELECT", "INSERT"]),
  });

/** Schemas the owner may hold USAGE on: `public` (granted) + the owned boundary schemas. */
export const OWNER_APPROVED_USAGE_SCHEMAS: readonly string[] = Object.freeze([
  "public",
  ...BOUNDARY_OWNED_SCHEMAS,
]);
const OWNER_APPROVED_USAGE_SQL = OWNER_APPROVED_USAGE_SCHEMAS.map((s) => `'${s}'`).join(", ");

/** All table privilege types, for the owner relation-privilege allowlist scan. */
const ALL_TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

/**
 * The dependency target relations the owner must be able to SELECT (read-only).
 */
export const DEPENDENCY_TARGET_RELATIONS: readonly string[] = Object.freeze(
  Object.entries(OWNER_TARGET_RELATION_PRIVILEGES)
    .filter(([, privs]) => privs.length === 1 && privs[0] === "SELECT")
    .map(([rel]) => rel),
);

/**
 * The import target relations the owner must be able to SELECT AND INSERT. These
 * also require an owner-scoped RLS INSERT policy (Review 10, blocker 4).
 */
export const IMPORT_TARGET_RELATIONS: readonly string[] = Object.freeze(
  Object.entries(OWNER_TARGET_RELATION_PRIVILEGES)
    .filter(([, privs]) => privs.includes("INSERT"))
    .map(([rel]) => rel),
);

/** Every target relation the owner reads (all six) — each needs RLS SELECT + is RLS-enabled. */
export const ALL_TARGET_RELATIONS: readonly string[] = Object.freeze(
  Object.keys(OWNER_TARGET_RELATION_PRIVILEGES),
);

const qualifiedRelationValues = (relations: readonly string[]): string =>
  relations
    .map((r) => {
      const [sch, rel] = r.split(".");
      return `('${sch}','${rel}')`;
    })
    .join(", ");

const ALL_TARGET_RELATION_VALUES = qualifiedRelationValues(ALL_TARGET_RELATIONS);

/**
 * The dedicated owner-scoped RLS policy is safe with a permissive predicate
 * because the owner is NOLOGIN and reachable ONLY through the SECURITY DEFINER
 * wrapper, which validates the entire request against the immutable approved
 * request before any write. The policy therefore delegates row validation to the
 * sole writer, and is scoped to exactly this role so no other principal gains
 * anything. `pg_policy.polcmd`: 'r' = SELECT, 'a' = INSERT, 'w' = UPDATE,
 * 'd' = DELETE, '*' = ALL.
 */
export const RLS_OWNER_POLICY_NOTE =
  "owner-scoped, wrapper-validated, no UPDATE/DELETE, no broad role" as const;

// ---------------------------------------------------------------------------
// Exact RLS policy state (Review 11)
// ---------------------------------------------------------------------------
// Review 10 proved only that SOME owner policy exists per table/command. That
// is insufficient for a security boundary: a same-name policy could be
// RESTRICTIVE, carry extra roles (or PUBLIC), use `USING (false)` or a helper
// routine, or be an ALL policy. Review 11 therefore pins the EXACT policy
// inventory (name, table, command, PERMISSIVE, exact role set, exact
// constant-true expressions), mirrors it in the migration's deterministic
// DROP-and-recreate normalization, and classifies EVERY policy on the six
// target tables that applies to the execution owner — directly, through the
// implicit PUBLIC pseudo-group (`pg_policy.polroles` containing OID 0, which
// applies to every role and is invisible to a `pg_roles` join), or through
// any transitive role membership — as exactly one of
// `required_execution_policy` / `approved_preexisting_read_policy` /
// `unexpected_policy`. An unclassified applicable policy blocks readiness.

export type RlsPolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

/** `pg_policy.polcmd` letter codes. */
export const POLICY_COMMAND_CODES: Readonly<Record<RlsPolicyCommand, string>> = Object.freeze({
  SELECT: "r",
  INSERT: "a",
  UPDATE: "w",
  DELETE: "d",
  ALL: "*",
});

/**
 * Tight normalization for comparing policy expressions as rendered by
 * `pg_get_expr(polqual|polwithcheck, polrelid)`: strip `public.` schema
 * qualification (the deparser qualifies target-table references only when
 * `public` is not on the caller's search_path, so both renderings are
 * equivalent for these expressions), then remove ALL whitespace (the deparser
 * lays subqueries out with version-styled indentation). Applied identically to
 * the observed rendering and to the committed expected strings, so comparison
 * is exact modulo those two purely-presentational variations — a semantically
 * different expression (a different constant, an extra disjunct, a function
 * call, a session setting) can never normalize onto an expected string.
 */
export function normalizePolicyExpression(expr: string): string {
  return expr.replace(/\bpublic\./g, "").replace(/\s+/g, "");
}

/**
 * The only accepted normalized renderings of the constant-true predicate.
 * `pg_get_expr` renders a bare boolean constant as `true`, and some rendering
 * paths parenthesize it. Nothing else — `false`, `(true OR x)`, `'true'`,
 * `truely`, a subquery, a helper call — normalizes onto either form.
 */
export const CONSTANT_TRUE_NORMALIZED_FORMS: readonly string[] = Object.freeze(["true", "(true)"]);

/** True only for an expression whose normalized rendering is the constant true. */
export function isConstantTruePolicyExpression(expr: string | null | undefined): boolean {
  if (typeof expr !== "string") return false;
  return CONSTANT_TRUE_NORMALIZED_FORMS.includes(normalizePolicyExpression(expr));
}

export interface RequiredRlsPolicy {
  schema: string;
  table: string;
  /** Stable dedicated per-table policy name (RC5.5D-owned, migration-normalized). */
  name: string;
  command: "SELECT" | "INSERT";
  /** `pg_policy.polcmd` code for {@link command}. */
  polcmd: "r" | "a";
  /** Every required policy is PERMISSIVE — a RESTRICTIVE one must fail. */
  permissive: true;
  /** EXACT role set: the dedicated execution owner and nothing else — never PUBLIC. */
  roles: readonly [typeof EXECUTION_OWNER_ROLE];
  /** USING expression: constant true for SELECT; MUST be absent for INSERT. */
  using: "true" | null;
  /** WITH CHECK expression: constant true for INSERT; MUST be absent for SELECT. */
  withCheck: "true" | null;
}

const requiredSelectPolicy = (qualified: string): RequiredRlsPolicy => {
  const [schema, table] = qualified.split(".");
  return {
    schema,
    table,
    name: `forever_import_owner_select_${table}`,
    command: "SELECT",
    polcmd: "r",
    permissive: true,
    roles: [EXECUTION_OWNER_ROLE],
    using: "true",
    withCheck: null,
  };
};

const requiredInsertPolicy = (qualified: string): RequiredRlsPolicy => {
  const [schema, table] = qualified.split(".");
  return {
    schema,
    table,
    name: `forever_import_owner_insert_${table}`,
    command: "INSERT",
    polcmd: "a",
    permissive: true,
    roles: [EXECUTION_OWNER_ROLE],
    using: null,
    withCheck: "true",
  };
};

/**
 * The EXACT ten RC5.5D-owned policies, derived from the same target-relation
 * inventories the capability allowlist uses (so the two can never drift):
 * owner SELECT on all six target tables, owner INSERT on the four import
 * tables. Mirrored verbatim by the migration's DROP-and-recreate section.
 */
export const REQUIRED_RLS_POLICIES: readonly RequiredRlsPolicy[] = Object.freeze([
  ...ALL_TARGET_RELATIONS.map(requiredSelectPolicy),
  ...IMPORT_TARGET_RELATIONS.map(requiredInsertPolicy),
]);

export interface ApprovedPreexistingReadPolicy {
  schema: string;
  table: string;
  name: string;
  command: "SELECT";
  polcmd: "r";
  permissive: true;
  /**
   * The pre-existing website policies carry no TO clause, so PostgreSQL stores
   * `polroles = {0}` — the implicit PUBLIC pseudo-group. They therefore apply
   * to the execution owner (PUBLIC applies to EVERY role) and cannot be made
   * inapplicable without altering unrelated application policies, which
   * RC5.5D must not do. They are instead individually enumerated here with
   * their complete expected definitions.
   */
  roles: "PUBLIC";
  /**
   * Accepted normalized `pg_get_expr(polqual, polrelid)` renderings: the
   * deparsed catalog form and the source form (both normalized through
   * {@link normalizePolicyExpression}). Any other rendering — ANY semantic
   * drift — fails classification and blocks readiness until the Owner
   * re-inspects the live definition.
   */
  usingNormalizedAccepted: readonly string[];
  withCheck: null;
  /** The committed migration that defines this policy. */
  sourceMigration: string;
}

/**
 * The complete, individually-inspected inventory of pre-existing application
 * policies on the six target tables (from the committed repository
 * migrations). ALL are SELECT-only, PERMISSIVE, and PUBLIC-applicable; none
 * grants any write, none is RESTRICTIVE, so none widens the owner's effective
 * access beyond the audited allowlist (permissive SELECT policies OR together,
 * and the owner's own `USING (true)` SELECT policy already spans every row)
 * and none can block the owner's required access. A NEW policy — even a
 * harmless-looking SELECT one — is NOT on this list and blocks readiness until
 * explicitly classified.
 */
export const APPROVED_PREEXISTING_READ_POLICIES: readonly ApprovedPreexistingReadPolicy[] =
  Object.freeze([
    {
      schema: "public",
      table: "developers",
      name: "Developers are viewable by everyone",
      command: "SELECT",
      polcmd: "r",
      permissive: true,
      roles: "PUBLIC",
      usingNormalizedAccepted: Object.freeze(["true", "(true)"]),
      withCheck: null,
      sourceMigration: "20260704055333_812d2f26-ad80-4807-b51a-bd3622cd5224.sql",
    },
    {
      schema: "public",
      table: "locations",
      name: "Locations are viewable by everyone",
      command: "SELECT",
      polcmd: "r",
      permissive: true,
      roles: "PUBLIC",
      usingNormalizedAccepted: Object.freeze(["true", "(true)"]),
      withCheck: null,
      sourceMigration: "20260704055333_812d2f26-ad80-4807-b51a-bd3622cd5224.sql",
    },
    {
      schema: "public",
      table: "projects",
      name: "Active projects are viewable by everyone",
      command: "SELECT",
      polcmd: "r",
      permissive: true,
      roles: "PUBLIC",
      usingNormalizedAccepted: Object.freeze([
        normalizePolicyExpression("(is_active = true)"),
        normalizePolicyExpression("is_active = true"),
      ]),
      withCheck: null,
      sourceMigration: "20260704055333_812d2f26-ad80-4807-b51a-bd3622cd5224.sql",
    },
    {
      schema: "public",
      table: "units",
      name: "Units of active projects are viewable by everyone",
      command: "SELECT",
      polcmd: "r",
      permissive: true,
      roles: "PUBLIC",
      usingNormalizedAccepted: Object.freeze([
        normalizePolicyExpression(
          "(EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = units.project_id) AND (p.is_active = true))))",
        ),
        normalizePolicyExpression(
          "EXISTS (SELECT 1 FROM public.projects p WHERE p.id = units.project_id AND p.is_active = true)",
        ),
      ]),
      withCheck: null,
      sourceMigration: "20260704055333_812d2f26-ad80-4807-b51a-bd3622cd5224.sql",
    },
    {
      schema: "public",
      table: "buildings",
      name: "Buildings of active projects are viewable",
      command: "SELECT",
      polcmd: "r",
      permissive: true,
      roles: "PUBLIC",
      usingNormalizedAccepted: Object.freeze([
        normalizePolicyExpression(
          "(EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = buildings.project_id) AND (p.is_active = true))))",
        ),
        normalizePolicyExpression(
          "EXISTS (SELECT 1 FROM public.projects p WHERE p.id = buildings.project_id AND p.is_active = true)",
        ),
      ]),
      withCheck: null,
      sourceMigration: "20260707101000_fdb001_inventory_facilities.sql",
    },
    {
      schema: "public",
      table: "unit_price_history",
      name: "Price history of active project units is viewable",
      command: "SELECT",
      polcmd: "r",
      permissive: true,
      roles: "PUBLIC",
      usingNormalizedAccepted: Object.freeze([
        normalizePolicyExpression(
          "(EXISTS ( SELECT 1 FROM (units u JOIN projects p ON ((p.id = u.project_id))) WHERE ((u.id = unit_price_history.unit_id) AND (p.is_active = true))))",
        ),
        normalizePolicyExpression(
          "EXISTS (SELECT 1 FROM public.units u JOIN public.projects p ON p.id = u.project_id WHERE u.id = unit_price_history.unit_id AND p.is_active = true)",
        ),
      ]),
      withCheck: null,
      sourceMigration: "20260707104000_fdb002b_unit_price_history.sql",
    },
  ]);

/**
 * Explicit runtime classification of one observed target-table policy
 * (Review 11). Every policy on the six target tables that applies to the
 * execution owner must classify as exactly one of these; `unexpected_policy`
 * blocks readiness. Classification is by COMPLETE definition — table, name,
 * command, permissive/restrictive mode, exact role set, and exact
 * USING / WITH CHECK expressions — never by command alone.
 */
export type TargetTablePolicyClassification =
  | "required_execution_policy"
  | "approved_preexisting_read_policy"
  | "unexpected_policy";

/**
 * One observed `pg_policy` row for classification. `roles` carries role NAMES;
 * the implicit PUBLIC pseudo-group (`polroles` containing OID 0 — PUBLIC is
 * not a `pg_roles` row and MUST NOT be resolved through a `pg_roles` join)
 * is represented by the sentinel string "PUBLIC".
 */
export interface ObservedTargetTablePolicy {
  schema: string;
  table: string;
  name: string;
  command: RlsPolicyCommand;
  permissive: boolean;
  roles: readonly string[];
  using: string | null;
  withCheck: string | null;
}

/**
 * True when the policy applies to the execution owner: it names the owner
 * directly, names PUBLIC (which applies to EVERY role, including the owner,
 * regardless of memberships), or names any role in the owner's transitive
 * membership closure. The owner's closure is required-empty elsewhere, but
 * this predicate stays correct and fails closed if that ever changes.
 */
export function policyAppliesToExecutionOwner(
  policy: Pick<ObservedTargetTablePolicy, "roles">,
  ownerMembershipClosure: readonly string[] = [],
): boolean {
  return policy.roles.some(
    (role) =>
      role === "PUBLIC" || role === EXECUTION_OWNER_ROLE || ownerMembershipClosure.includes(role),
  );
}

/**
 * Classify one observed target-table policy. A policy carrying a required or
 * approved NAME but ANY deviation in its complete definition (wrong table,
 * wrong command, RESTRICTIVE, extra role, PUBLIC instead of the owner, a
 * non-constant or false predicate, an unexpected expression on the other
 * side) is `unexpected_policy` — definition drift always fails closed.
 */
export function classifyTargetTablePolicy(
  policy: ObservedTargetTablePolicy,
): TargetTablePolicyClassification {
  const required = REQUIRED_RLS_POLICIES.find(
    (p) => p.schema === policy.schema && p.table === policy.table && p.name === policy.name,
  );
  if (required) {
    const definitionMatches =
      policy.command === required.command &&
      policy.permissive === true &&
      policy.roles.length === 1 &&
      policy.roles[0] === EXECUTION_OWNER_ROLE &&
      (required.command === "SELECT"
        ? isConstantTruePolicyExpression(policy.using) && policy.withCheck === null
        : policy.using === null && isConstantTruePolicyExpression(policy.withCheck));
    return definitionMatches ? "required_execution_policy" : "unexpected_policy";
  }
  const approved = APPROVED_PREEXISTING_READ_POLICIES.find(
    (p) => p.schema === policy.schema && p.table === policy.table && p.name === policy.name,
  );
  if (approved) {
    const definitionMatches =
      policy.command === "SELECT" &&
      policy.permissive === true &&
      policy.roles.length === 1 &&
      policy.roles[0] === "PUBLIC" &&
      typeof policy.using === "string" &&
      approved.usingNormalizedAccepted.includes(normalizePolicyExpression(policy.using)) &&
      policy.withCheck === null;
    return definitionMatches ? "approved_preexisting_read_policy" : "unexpected_policy";
  }
  return "unexpected_policy";
}

// ----- SQL fragments for the Review 11 exact-policy checks -------------------

/** SQL VALUES rows `(schema, table, name, polcmd)` of all ten required policies. */
const REQUIRED_RLS_POLICY_VALUES = REQUIRED_RLS_POLICIES.map(
  (p) => `('${p.schema}','${p.table}','${p.name}','${p.polcmd}')`,
).join(",\n            ");

const REQUIRED_RLS_SELECT_VALUES = REQUIRED_RLS_POLICIES.filter((p) => p.command === "SELECT")
  .map((p) => `('${p.schema}','${p.table}','${p.name}')`)
  .join(",\n            ");

const REQUIRED_RLS_INSERT_VALUES = REQUIRED_RLS_POLICIES.filter((p) => p.command === "INSERT")
  .map((p) => `('${p.schema}','${p.table}','${p.name}')`)
  .join(",\n            ");

const REQUIRED_RLS_POLICY_NAMES_SQL = REQUIRED_RLS_POLICIES.map((p) => `'${p.name}'`).join(", ");

/**
 * SQL VALUES rows `(schema, table, name, accepted_a, accepted_b)` of the
 * approved pre-existing read policies with their accepted normalized USING
 * renderings (deparsed catalog form and source form).
 */
const APPROVED_PREEXISTING_POLICY_VALUES = APPROVED_PREEXISTING_READ_POLICIES.map(
  (p) =>
    `('${p.schema}','${p.table}','${p.name}','${p.usingNormalizedAccepted[0]}','${
      p.usingNormalizedAccepted[1] ?? p.usingNormalizedAccepted[0]
    }')`,
).join(",\n            ");

const CONSTANT_TRUE_FORMS_SQL = CONSTANT_TRUE_NORMALIZED_FORMS.map((f) => `'${f}'`).join(", ");

/**
 * SQL mirror of {@link normalizePolicyExpression}, in the same order: strip
 * `public.` qualification at a word start (POSIX `\\m` ≙ the JS `\\b` used in
 * the TypeScript normalizer for this pattern), then strip all whitespace.
 */
const normalizedPolicyExprSql = (expr: string): string =>
  `pg_catalog.regexp_replace(pg_catalog.regexp_replace(${expr}, '\\mpublic\\.', '', 'g'), '\\s+', '', 'g')`;

const NORMALIZED_POLQUAL = normalizedPolicyExprSql(
  "pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)",
);
const NORMALIZED_POLWITHCHECK = normalizedPolicyExprSql(
  "pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)",
);

/**
 * SQL: TRUE when the policy row `pol` applies to the execution owner `ow` —
 * directly (owner OID in `polroles`), via the implicit PUBLIC pseudo-group
 * (`polroles` containing OID 0 — PUBLIC is NOT a `pg_roles` row, so a
 * `pg_roles` join can never surface it), or via ANY transitive membership of
 * the owner. The owner's closure is required-empty elsewhere; this predicate
 * stays correct and fails closed if that ever changes. The raw
 * `pg_auth_members` closure is a conservative superset of PostgreSQL's
 * INHERIT-aware policy-role matching, so it can only over-detect (fail
 * closed), never under-detect.
 */
const POLICY_APPLIES_TO_OWNER_SQL = `(
        ow.oid = ANY (pol.polroles)
        OR 0::pg_catalog.oid = ANY (pol.polroles)
        OR EXISTS (
          WITH RECURSIVE owner_groups(roleid) AS (
            SELECT am.roleid FROM pg_catalog.pg_auth_members am WHERE am.member = ow.oid
            UNION
            SELECT am.roleid
            FROM pg_catalog.pg_auth_members am
            JOIN owner_groups og ON am.member = og.roleid
          )
          SELECT 1 FROM owner_groups og WHERE og.roleid = ANY (pol.polroles)
        )
      )`;

/**
 * SQL: TRUE when `pol` exactly matches the required-policy definition row
 * `req(sch, rel, polname, cmd)` it was name/table-matched to: exact command,
 * PERMISSIVE, role set exactly `{owner}` (array equality — excludes PUBLIC,
 * extra roles, and the empty set), and exact constant-true expressions on
 * exactly the right side (USING for SELECT with no WITH CHECK; WITH CHECK for
 * INSERT with no USING).
 */
const REQUIRED_POLICY_DEFINITION_MATCH_SQL = `(
        pol.polcmd::pg_catalog.text = req.cmd
        AND pol.polpermissive
        AND pol.polroles = ARRAY[ow.oid]::pg_catalog.oid[]
        AND CASE WHEN req.cmd = 'r'
          THEN pol.polqual IS NOT NULL
            AND ${NORMALIZED_POLQUAL} IN (${CONSTANT_TRUE_FORMS_SQL})
            AND pol.polwithcheck IS NULL
          ELSE pol.polqual IS NULL
            AND pol.polwithcheck IS NOT NULL
            AND ${NORMALIZED_POLWITHCHECK} IN (${CONSTANT_TRUE_FORMS_SQL})
        END
      )`;

/** SQL VALUES list of the exact boundary routine inventory. */
const BOUNDARY_ROUTINE_VALUES = BOUNDARY_ROUTINES.map(
  (r) => `('${r.schema}','${r.name}','${r.identityArgs}','${r.prokind}',${r.securityDefiner})`,
).join(",\n            ");

/** SQL VALUES list of the exact boundary relations. */
const BOUNDARY_RELATION_VALUES = BOUNDARY_RELATIONS.map((r) => `('${r.schema}','${r.name}')`).join(
  ", ",
);

/**
 * SQL boolean (for a `pg_class c` + `pg_namespace n` join) that is TRUE when the
 * relation is one of the exact approved target relations AND the owner holds only
 * privileges within that relation's allowlist. Used to let the "only approved
 * relation privileges" scan pass the approved target tables while failing on any
 * extra privilege or any other relation.
 */
function ownerRelationWithinAllowlist(): string {
  const perRelation = Object.entries(OWNER_TARGET_RELATION_PRIVILEGES).map(([qualified, privs]) => {
    const [sch, rel] = qualified.split(".");
    const forbidden = ALL_TABLE_PRIVILEGES.filter((p) => !privs.includes(p));
    const forbiddenClause =
      forbidden.length === 0
        ? "true"
        : `NOT (${forbidden
            .map((p) => `pg_catalog.has_table_privilege(ow.oid, c.oid, '${p}')`)
            .join(" OR ")})`;
    return `(n.nspname = '${sch}' AND c.relname = '${rel}' AND ${forbiddenClause})`;
  });
  return `(${perRelation.join("\n            OR ")})`;
}

/**
 * The audit checks.
 *
 * Executor-effective checks use `has_*_privilege(r.oid, <object>.oid, priv)`.
 * PUBLIC-ACL checks use `aclexplode` over `COALESCE(<acl>, acldefault(...))`
 * matched on the PUBLIC grantee OID `0`. Whole-surface and execution-chain
 * checks scan every non-system schema / the routine-owner chain. `pg_catalog` is
 * schema-qualified everywhere. Every check fails closed when its role or object
 * is missing.
 */
export const EFFECTIVE_PRIVILEGE_AUDIT: readonly EffectivePrivilegeCheck[] = Object.freeze([
  // ----- Existence anchors (required) --------------------------------------
  {
    name: "executor_role_exists",
    classification: "required",
    sql: q(`SELECT EXISTS (SELECT 1 FROM ${ROLE} WHERE ${ROLE_WHERE}) AS ok`),
    rationale: "The dedicated executor role exists (a missing role fails closed).",
  },
  {
    name: "execution_wrapper_exists",
    classification: "required",
    sql: q(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ${WRAPPER_PREDICATE}
      ) AS ok
    `),
    rationale: "The single wrapper function exists with the exact (jsonb) signature.",
  },
  // ----- Required capabilities (exactly two) -------------------------------
  {
    name: "executor_has_execution_schema_usage",
    classification: "required",
    sql: q(`
      SELECT COALESCE((
        SELECT pg_catalog.has_schema_privilege(r.oid, ns.oid, 'USAGE')
        FROM ${ROLE}
        JOIN pg_catalog.pg_namespace ns ON ns.nspname = '${EXECUTION_SCHEMA}'
        WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale: "Executor can resolve objects in the dedicated execution schema.",
  },
  {
    name: "executor_can_execute_wrapper",
    classification: "required",
    sql: q(`
      SELECT COALESCE((
        SELECT pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
        FROM ${ROLE}
        JOIN pg_catalog.pg_proc p ON true
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ${ROLE_WHERE} AND ${WRAPPER_PREDICATE}
      ), false) AS ok
    `),
    rationale: "Executor can execute exactly the one bounded wrapper.",
  },

  // ----- PUBLIC-ACL checks (aclexplode + acldefault, PUBLIC grantee 0) ------
  {
    name: "public_execution_schema_usage_grant_absent",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
          ) AS a
          WHERE a.grantee = 0 AND a.privilege_type = 'USAGE'
        )
        FROM pg_catalog.pg_namespace n
        WHERE n.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "PUBLIC (grantee OID 0) holds no USAGE on the dedicated execution schema, per its ACL (NULL folded through acldefault).",
  },
  {
    name: "public_wrapper_execute_grant_absent",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) AS a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ${WRAPPER_PREDICATE}
      ), false) AS ok
    `),
    rationale:
      "PUBLIC (grantee OID 0) holds no EXECUTE on the wrapper; the default PUBLIC EXECUTE (NULL proacl → acldefault) is reversed by the migration.",
  },
  {
    name: "public_schema_grants_no_public_usage",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
          ) AS a
          WHERE a.grantee = 0 AND a.privilege_type = 'USAGE'
        )
        FROM pg_catalog.pg_namespace n
        WHERE n.nspname = 'public'
      ), false) AS ok
    `),
    rationale:
      "Diagnoses whether the 'public' schema grants USAGE to PUBLIC (grantee 0). A stock target commonly does; option B classifies this as BLOCKING pending a separate Owner-approved target-ACL reconciliation.",
  },

  // ----- Executor effective public-schema reachability (option B) ----------
  {
    name: "executor_no_effective_public_schema_usage",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT pg_catalog.has_schema_privilege(r.oid, ns.oid, 'USAGE')
        FROM ${ROLE}
        JOIN pg_catalog.pg_namespace ns ON ns.nspname = 'public'
        WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor's EFFECTIVE (direct + inherited + PUBLIC) USAGE on the 'public' schema. If PUBLIC confers it, this blocks readiness (option B) — a direct REVOKE cannot remove a PUBLIC-derived grant.",
  },

  // ----- Execution-schema & private-schema focused (must_be_absent) --------
  {
    name: "executor_no_other_executable_function_in_execution_schema",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = '${EXECUTION_SCHEMA}'
            AND NOT (
              p.proname = '${EXECUTION_WRAPPER_NAME}'
              AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '${EXECUTION_WRAPPER_ARGS}'
            )
            AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The wrapper is the ONLY function the executor can execute in the execution schema; any second executable function fails this.",
  },
  {
    name: "executor_no_forever_import_schema_usage",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT pg_catalog.has_schema_privilege(r.oid, ns.oid, 'USAGE')
        FROM ${ROLE}
        JOIN pg_catalog.pg_namespace ns ON ns.nspname = '${PRIVATE_SCHEMA}'
        WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale: "Executor has no USAGE on the private forever_import schema (direct or PUBLIC).",
  },
  {
    name: "executor_no_forever_import_function_execute",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = '${PRIVATE_SCHEMA}'
            AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor can EXECUTE no internal forever_import routine directly (direct or PUBLIC-derived).",
  },
  {
    name: "executor_no_forever_import_table_dml",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = '${PRIVATE_SCHEMA}' AND c.relkind IN ('r','p')
            AND (
              pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE')
            )
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor has no effective DML on the durable approval/receipt tables (direct or PUBLIC-derived).",
  },

  // ----- Whole non-system surface (every schema not on the system allowlist)
  {
    name: "executor_no_table_privileges_in_non_system_schemas",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','f')
            AND ${NON_SYSTEM_N}
            AND (
              pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'TRUNCATE')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'REFERENCES')
              OR pg_catalog.has_table_privilege(r.oid, c.oid, 'TRIGGER')
            )
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor has no effective SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on ANY table, partitioned table, view, materialized view, or foreign table in ANY non-system schema (direct or PUBLIC-derived).",
  },
  {
    name: "executor_no_sequence_privileges_in_non_system_schemas",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S'
            AND ${NON_SYSTEM_N}
            AND (
              pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE')
              OR pg_catalog.has_sequence_privilege(r.oid, c.oid, 'SELECT')
              OR pg_catalog.has_sequence_privilege(r.oid, c.oid, 'UPDATE')
            )
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor has no effective USAGE/SELECT/UPDATE on ANY sequence in ANY non-system schema (a bypass-supporting privilege the SECURITY DEFINER owner uses internally, never the caller).",
  },
  {
    name: "executor_no_create_on_non_system_schemas",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace n
          WHERE ${NON_SYSTEM_N}
            AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor holds no effective CREATE on ANY non-system schema (direct or PUBLIC-derived), so it cannot create objects anywhere in the application surface.",
  },
  {
    name: "executor_no_routine_execute_outside_wrapper",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prokind IN ('f','p','a','w')
            AND ${NON_SYSTEM_N}
            AND NOT (
              n.nspname = '${EXECUTION_SCHEMA}'
              AND p.proname = '${EXECUTION_WRAPPER_NAME}'
              AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '${EXECUTION_WRAPPER_ARGS}'
            )
            AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor can EXECUTE NO routine — function, procedure, aggregate, or window, SECURITY DEFINER or INVOKER, in ANY non-system schema — other than exactly the approved wrapper. Any other executable routine (commonly PUBLIC-executable on a stock target) blocks readiness pending Owner reconciliation.",
  },
  {
    name: "executor_no_security_definer_execute_outside_wrapper",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef = true
            AND ${NON_SYSTEM_N}
            AND NOT (
              n.nspname = '${EXECUTION_SCHEMA}'
              AND p.proname = '${EXECUTION_WRAPPER_NAME}'
              AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '${EXECUTION_WRAPPER_ARGS}'
            )
            AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor can EXECUTE no SECURITY DEFINER routine in ANY non-system schema other than the approved wrapper (a focused escalation-risk signal within the broader routine check).",
  },
  {
    name: "executor_no_usage_on_unexpected_non_system_schema",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace n
          WHERE ${NON_SYSTEM_N}
            AND n.nspname NOT IN ('${EXECUTION_SCHEMA}', 'public')
            AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor has effective USAGE on no unexpected non-system schema (only the required forever_execution and the option-B-classified public). USAGE elsewhere exposes a potentially privileged callable surface and blocks readiness pending Owner reconciliation.",
  },
  {
    name: "no_unexpected_non_system_schema",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace n
          WHERE ${NON_SYSTEM_N}
            AND n.nspname NOT IN (${APPROVED_AND_PROHIBITED_SQL})
        )
        FROM pg_catalog.pg_namespace anchor
        WHERE anchor.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "Every non-system schema is explicitly classified (approved_required or explicitly_prohibited). Any other non-system schema is unexpected_surface and BLOCKS readiness until the Owner explicitly classifies it — a newly introduced schema can never silently pass.",
  },

  // ----- Complete execution chain (Review 8, blocker 2) --------------------
  {
    name: "execution_chain_wrapper_owner_not_broad",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT ${ownerIsBroad("o")}
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_roles o ON o.oid = p.proowner
        WHERE ${WRAPPER_PREDICATE}
      ), false) AS ok
    `),
    rationale:
      "The SECURITY DEFINER wrapper runs as its OWNER, so the transition target must NOT be a superuser, BYPASSRLS holder, known broad platform role, or a member of one. A broad owner blocks readiness pending explicit Owner justification/reconciliation.",
  },
  {
    name: "execution_chain_internal_routine_owners_not_broad",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_catalog.pg_roles o ON o.oid = p.proowner
          WHERE n.nspname IN ('${PRIVATE_SCHEMA}', '${EXECUTION_SCHEMA}')
            AND ${ownerIsBroad("o")}
        )
        FROM pg_catalog.pg_namespace anchor
        WHERE anchor.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "No routine in the private or execution schema (the wrapper and every internal routine it invokes in the definer context) is owned by a superuser, BYPASSRLS holder, broad platform role, or a member of one. A broad internal-routine owner blocks readiness.",
  },
  {
    name: "execution_chain_executor_is_dedicated_login_role",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          r.rolcanlogin
          AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolinherit
          AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The executor is a dedicated LOGIN role (the transport authenticates AS it) with NOINHERIT and no ambient authority — not super/bypassrls/createdb/createrole/replication — so no SET ROLE / inheritance path escalates it.",
  },

  // ----- Database-level and role shape (must_be_absent) --------------------
  {
    name: "executor_no_database_create",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE')
        FROM ${ROLE}
        JOIN pg_catalog.pg_database d ON d.datname = pg_catalog.current_database()
        WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale: "Executor holds no database-level CREATE (no schema creation).",
  },
  {
    name: "executor_no_database_temp",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT pg_catalog.has_database_privilege(r.oid, d.oid, 'TEMP')
        FROM ${ROLE}
        JOIN pg_catalog.pg_database d ON d.datname = pg_catalog.current_database()
        WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor holds no database TEMP. A stock target grants TEMP to PUBLIC by default; option B classifies a PUBLIC-derived TEMP as blocking pending Owner reconciliation (TEMP is not required by the bounded wrapper).",
  },
  {
    name: "executor_has_no_role_memberships",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor is a member of no role, so it inherits nothing and has no SET ROLE path to another principal.",
  },
  {
    name: "executor_role_flags_are_minimal",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          r.rolsuper = false AND r.rolinherit = false AND r.rolcreatedb = false
          AND r.rolcreaterole = false AND r.rolreplication = false AND r.rolbypassrls = false
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor has no ambient authority: not super/inherit/createdb/createrole/replication/bypassrls.",
  },

  // ----- Ownership audit (authority beyond ordinary ACL privileges) --------
  {
    name: "executor_owns_no_database",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_database d WHERE d.datdba = r.oid
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale: "Executor owns no database (an owner can ALTER/DROP regardless of ACL grants).",
  },
  {
    name: "executor_owns_no_schema",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale: "Executor owns no schema.",
  },
  {
    name: "executor_owns_no_relation",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c
          WHERE c.relowner = r.oid AND c.relkind IN ('r','p','S','v','m','f')
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor owns no table, sequence, view, materialized view, partitioned or foreign table.",
  },
  {
    name: "executor_owns_no_routine",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner = r.oid
        )
        FROM ${ROLE} WHERE ${ROLE_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Executor owns no function/procedure/aggregate/window routine (an owner could ALTER it, e.g. flip SECURITY DEFINER or its privileges).",
  },

  // ----- Dedicated execution-boundary owner: identity & role shape ---------
  {
    name: "execution_owner_role_exists",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT true FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The dedicated execution-boundary owner role exists (missing → fails closed).",
  },
  {
    name: "execution_owner_role_is_exact_no_login_role",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          NOT ow.rolcanlogin AND NOT ow.rolsuper AND NOT ow.rolinherit
          AND NOT ow.rolcreatedb AND NOT ow.rolcreaterole AND NOT ow.rolreplication
          AND NOT ow.rolbypassrls
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner is exactly NOLOGIN with no ambient authority (not super/inherit/createdb/createrole/replication/bypassrls).",
  },
  {
    name: "execution_owner_has_no_direct_memberships",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = ow.oid
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner is a direct member of no role.",
  },
  {
    name: "execution_owner_has_no_transitive_memberships",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          WITH RECURSIVE reach(roleid) AS (
            SELECT am.roleid
            FROM pg_catalog.pg_auth_members am
            JOIN pg_catalog.pg_roles owr ON owr.oid = am.member
            WHERE owr.rolname = '${EXECUTION_OWNER_ROLE}'
            UNION
            SELECT am.roleid
            FROM pg_catalog.pg_auth_members am
            JOIN reach ON am.member = reach.roleid
          )
          SELECT 1 FROM reach
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Recursive membership closure of the owner is empty — it is not directly OR transitively a member of any role (UNION dedups, so cyclic data terminates and still fails closed).",
  },
  {
    name: "execution_owner_has_no_set_role_path",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          WITH RECURSIVE reach(roleid) AS (
            SELECT am.roleid
            FROM pg_catalog.pg_auth_members am
            JOIN pg_catalog.pg_roles owr ON owr.oid = am.member
            WHERE owr.rolname = '${EXECUTION_OWNER_ROLE}'
            UNION
            SELECT am.roleid
            FROM pg_catalog.pg_auth_members am
            JOIN reach ON am.member = reach.roleid
          )
          SELECT 1
          FROM reach
          JOIN pg_catalog.pg_roles g ON g.oid = reach.roleid
          WHERE g.rolsuper OR g.rolname IN (${BROAD_ROLES_SQL})
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "No role reachable from the owner via the membership closure (its SET ROLE targets) is a superuser or broad platform role — no SET ROLE path to a broader identity.",
  },

  // ----- Exact boundary ownership ------------------------------------------
  {
    name: "wrapper_owned_by_exact_execution_owner",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (o.rolname = '${EXECUTION_OWNER_ROLE}')
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_roles o ON o.oid = p.proowner
        WHERE ${WRAPPER_PREDICATE}
      ), false) AS ok
    `),
    rationale:
      "The SECURITY DEFINER wrapper is owned by EXACTLY forever_import_execution_owner — not postgres/service_role/a platform role/the executor/any other role.",
  },
  {
    name: "internal_routines_owned_by_exact_execution_owner",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_catalog.pg_roles o ON o.oid = p.proowner
          WHERE n.nspname IN (${BOUNDARY_SCHEMAS_SQL})
            AND o.rolname <> '${EXECUTION_OWNER_ROLE}'
        )
        FROM pg_catalog.pg_namespace anchor WHERE anchor.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "Every routine in the boundary schemas is owned by EXACTLY the execution owner (no mixed owners).",
  },
  {
    name: "boundary_relations_owned_by_exact_execution_owner",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM (VALUES ${BOUNDARY_RELATION_VALUES}) AS inv(sch, rel)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_roles o ON o.oid = c.relowner
            WHERE n.nspname = inv.sch AND c.relname = inv.rel
              AND o.rolname = '${EXECUTION_OWNER_ROLE}'
          )
        )
        FROM pg_catalog.pg_namespace anchor WHERE anchor.nspname = '${PRIVATE_SCHEMA}'
      ), false) AS ok
    `),
    rationale: "Both durable boundary tables exist and are owned by EXACTLY the execution owner.",
  },
  {
    name: "boundary_sequences_owned_by_exact_execution_owner",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_catalog.pg_roles o ON o.oid = c.relowner
          WHERE c.relkind = 'S' AND n.nspname IN (${BOUNDARY_SCHEMAS_SQL})
            AND o.rolname <> '${EXECUTION_OWNER_ROLE}'
        )
        FROM pg_catalog.pg_namespace anchor WHERE anchor.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "Any sequence in the boundary schemas (the exact inventory is empty — UUID keys) is owned by the execution owner; a foreign-owned boundary sequence fails.",
  },

  // ----- Owner owns nothing outside the approved inventory ------------------
  {
    name: "execution_owner_owns_no_unexpected_schema",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_namespace n
          WHERE n.nspowner = ow.oid AND n.nspname NOT IN (${BOUNDARY_SCHEMAS_SQL})
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner owns only the two boundary schemas — no other schema.",
  },
  {
    name: "execution_owner_owns_no_unexpected_relation",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relowner = ow.oid
            AND c.relkind IN ('r','p','v','m','f')
            AND (n.nspname, c.relname) NOT IN (VALUES ${BOUNDARY_RELATION_VALUES})
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner owns only the two boundary tables — no other table, view, materialized view, partitioned or foreign table (indexes/toast excluded).",
  },
  {
    name: "execution_owner_owns_no_unexpected_sequence",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c WHERE c.relowner = ow.oid AND c.relkind = 'S'
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner owns no sequence (the boundary sequence inventory is empty).",
  },
  {
    name: "execution_owner_owns_no_unexpected_routine",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proowner = ow.oid AND n.nspname NOT IN (${BOUNDARY_SCHEMAS_SQL})
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner owns routines only in the two boundary schemas — none elsewhere.",
  },
  {
    name: "execution_owner_owns_no_database",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_database d WHERE d.datdba = ow.oid
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner owns no database.",
  },

  // ----- Exact boundary inventories ----------------------------------------
  {
    name: "execution_boundary_routine_inventory_exact",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          (
            SELECT count(*) FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN (${BOUNDARY_SCHEMAS_SQL})
          ) = ${BOUNDARY_ROUTINES.length}
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN (${BOUNDARY_SCHEMAS_SQL})
              AND NOT EXISTS (
                SELECT 1 FROM (VALUES
            ${BOUNDARY_ROUTINE_VALUES}
                ) AS inv(sch, nm, args, kind, secdef)
                WHERE inv.sch = n.nspname
                  AND inv.nm = p.proname
                  AND inv.args = pg_catalog.pg_get_function_identity_arguments(p.oid)
                  AND inv.kind = p.prokind::text
                  AND inv.secdef = p.prosecdef
              )
          )
        )
        FROM pg_catalog.pg_namespace anchor WHERE anchor.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "The boundary schemas contain EXACTLY the approved routine inventory — count, schema, name, identity arguments, prokind, and SECURITY DEFINER flag all match; a missing/extra/overloaded/renamed/re-typed/re-flagged routine fails.",
  },
  {
    name: "execution_boundary_relation_inventory_exact",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          (
            SELECT count(*) FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN (${BOUNDARY_SCHEMAS_SQL}) AND c.relkind IN ('r','p')
          ) = ${BOUNDARY_RELATIONS.length}
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN (${BOUNDARY_SCHEMAS_SQL}) AND c.relkind IN ('r','p')
              AND (n.nspname, c.relname) NOT IN (VALUES ${BOUNDARY_RELATION_VALUES})
          )
        )
        FROM pg_catalog.pg_namespace anchor WHERE anchor.nspname = '${PRIVATE_SCHEMA}'
      ), false) AS ok
    `),
    rationale:
      "The boundary schemas contain EXACTLY the two approved tables — no unexpected relation.",
  },
  {
    name: "execution_boundary_sequence_inventory_exact",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          SELECT count(*) FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname IN (${BOUNDARY_SCHEMAS_SQL}) AND c.relkind = 'S'
        ) = ${BOUNDARY_SEQUENCES.length}
        FROM pg_catalog.pg_namespace anchor WHERE anchor.nspname = '${EXECUTION_SCHEMA}'
      ), false) AS ok
    `),
    rationale: "The boundary schemas contain EXACTLY zero sequences (UUID keys).",
  },

  // ----- Owner effective-capability allowlist (option B) -------------------
  {
    name: "execution_owner_has_only_approved_schema_privileges",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_namespace n
          WHERE ${NON_SYSTEM_N}
            AND (
              (
                pg_catalog.has_schema_privilege(ow.oid, n.oid, 'CREATE')
                AND n.nspname NOT IN (${BOUNDARY_SCHEMAS_SQL})
              )
              OR (
                pg_catalog.has_schema_privilege(ow.oid, n.oid, 'USAGE')
                AND n.nspname NOT IN (${OWNER_APPROVED_USAGE_SQL})
              )
            )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner has CREATE only on the boundary schemas it owns, and USAGE only on public plus the boundary schemas. Any other non-system schema USAGE/CREATE (e.g. PUBLIC-derived on a stock target) blocks readiness pending reconciliation.",
  },
  {
    name: "execution_owner_has_only_approved_relation_privileges",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','f')
            AND ${NON_SYSTEM_N}
            AND (
              pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
              OR pg_catalog.has_table_privilege(ow.oid, c.oid, 'INSERT')
              OR pg_catalog.has_table_privilege(ow.oid, c.oid, 'UPDATE')
              OR pg_catalog.has_table_privilege(ow.oid, c.oid, 'DELETE')
              OR pg_catalog.has_table_privilege(ow.oid, c.oid, 'TRUNCATE')
              OR pg_catalog.has_table_privilege(ow.oid, c.oid, 'REFERENCES')
              OR pg_catalog.has_table_privilege(ow.oid, c.oid, 'TRIGGER')
            )
            AND c.relowner <> ow.oid
            AND NOT ${ownerRelationWithinAllowlist()}
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner holds table privileges ONLY on the exact approved target relations (SELECT on the two dependency tables; SELECT+INSERT on the four import tables) and on the boundary tables it owns. Any privilege on any other relation, or any forbidden privilege (UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on an approved target, blocks readiness.",
  },
  {
    name: "execution_owner_has_only_approved_sequence_privileges",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S'
            AND ${NON_SYSTEM_N}
            AND c.relowner <> ow.oid
            AND (
              pg_catalog.has_sequence_privilege(ow.oid, c.oid, 'USAGE')
              OR pg_catalog.has_sequence_privilege(ow.oid, c.oid, 'SELECT')
              OR pg_catalog.has_sequence_privilege(ow.oid, c.oid, 'UPDATE')
            )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner holds no sequence privilege on any non-system sequence it does not own (the import uses no sequence). A PUBLIC-derived sequence privilege blocks readiness pending reconciliation.",
  },
  {
    name: "execution_owner_has_only_approved_routine_execute",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE ${NON_SYSTEM_N}
            AND p.proowner <> ow.oid
            AND pg_catalog.has_function_privilege(ow.oid, p.oid, 'EXECUTE')
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner can EXECUTE only routines it owns (the approved internal call graph). EXECUTE on any other non-system routine (e.g. PUBLIC-executable on a stock target) blocks readiness pending reconciliation.",
  },
  {
    name: "execution_owner_no_database_create",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT pg_catalog.has_database_privilege(ow.oid, d.oid, 'CREATE')
        FROM ${OWNER}
        JOIN pg_catalog.pg_database d ON d.datname = pg_catalog.current_database()
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner holds no database-level CREATE.",
  },
  {
    name: "execution_owner_no_database_temp",
    classification: "blocking_unless_reconciled",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT pg_catalog.has_database_privilege(ow.oid, d.oid, 'TEMP')
        FROM ${OWNER}
        JOIN pg_catalog.pg_database d ON d.datname = pg_catalog.current_database()
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner holds no database TEMP; a PUBLIC-derived TEMP on a stock target blocks readiness pending reconciliation.",
  },

  // ----- Owner POSITIVE required capabilities (operability, Review 10) ------
  // These prove the owner ACTUALLY holds every privilege the bounded import
  // needs. Without them the negative allowlist checks could pass while the
  // SECURITY DEFINER path fails with a permission error ("safe but inoperable").
  {
    name: "execution_owner_has_required_public_schema_usage",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT pg_catalog.has_schema_privilege(ow.oid, ns.oid, 'USAGE')
        FROM ${OWNER}
        JOIN pg_catalog.pg_namespace ns ON ns.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The owner has EFFECTIVE USAGE on schema public (required to resolve the fully-qualified target tables). Fails closed if the role or schema is missing.",
  },
  {
    name: "execution_owner_has_required_developer_select",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
        FROM ${OWNER}
        JOIN pg_catalog.pg_class c ON c.relname = 'developers'
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner has EFFECTIVE SELECT on public.developers (dependency read).",
  },
  {
    name: "execution_owner_has_required_location_select",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
        FROM ${OWNER}
        JOIN pg_catalog.pg_class c ON c.relname = 'locations'
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner has EFFECTIVE SELECT on public.locations (dependency read).",
  },
  {
    name: "execution_owner_has_required_project_select_insert",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
          AND pg_catalog.has_table_privilege(ow.oid, c.oid, 'INSERT')
        )
        FROM ${OWNER}
        JOIN pg_catalog.pg_class c ON c.relname = 'projects'
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner has EFFECTIVE SELECT and INSERT on public.projects.",
  },
  {
    name: "execution_owner_has_required_building_select_insert",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
          AND pg_catalog.has_table_privilege(ow.oid, c.oid, 'INSERT')
        )
        FROM ${OWNER}
        JOIN pg_catalog.pg_class c ON c.relname = 'buildings'
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner has EFFECTIVE SELECT and INSERT on public.buildings.",
  },
  {
    name: "execution_owner_has_required_unit_select_insert",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
          AND pg_catalog.has_table_privilege(ow.oid, c.oid, 'INSERT')
        )
        FROM ${OWNER}
        JOIN pg_catalog.pg_class c ON c.relname = 'units'
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner has EFFECTIVE SELECT and INSERT on public.units.",
  },
  {
    name: "execution_owner_has_required_price_history_select_insert",
    classification: "required_capability",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          pg_catalog.has_table_privilege(ow.oid, c.oid, 'SELECT')
          AND pg_catalog.has_table_privilege(ow.oid, c.oid, 'INSERT')
        )
        FROM ${OWNER}
        JOIN pg_catalog.pg_class c ON c.relname = 'unit_price_history'
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale: "The owner has EFFECTIVE SELECT and INSERT on public.unit_price_history.",
  },

  // ----- RLS compatibility (operability under Row-Level Security) -----------
  {
    name: "rls_target_tables_row_security_enabled",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          count(*) FILTER (WHERE c.relrowsecurity) = ${ALL_TARGET_RELATIONS.length}
          AND count(*) = ${ALL_TARGET_RELATIONS.length}
        )
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE (n.nspname, c.relname) IN (VALUES ${ALL_TARGET_RELATION_VALUES})
      ), false) AS ok
    `),
    rationale:
      "All six target tables exist and have ROW LEVEL SECURITY enabled (the committed repository state the owner-scoped policies are designed against). A missing table or disabled RLS is a state drift that blocks readiness.",
  },
  // ----- Exact required-policy definitions (Review 11) ----------------------
  {
    name: "rls_required_policy_inventory_exact",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          NOT EXISTS (
            SELECT 1 FROM (VALUES ${REQUIRED_RLS_POLICY_VALUES}) AS req(sch, rel, polname, cmd)
            WHERE NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_policy pol
              JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = req.sch AND c.relname = req.rel
                AND pol.polname = req.polname
                AND pol.polcmd::pg_catalog.text = req.cmd
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy pol
            JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE pol.polname IN (${REQUIRED_RLS_POLICY_NAMES_SQL})
              AND NOT EXISTS (
                SELECT 1 FROM (VALUES ${REQUIRED_RLS_POLICY_VALUES}) AS req(sch, rel, polname, cmd)
                WHERE req.sch = n.nspname AND req.rel = c.relname AND req.polname = pol.polname
              )
          )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "EXACT required-policy inventory: every one of the ten dedicated RC5.5D policies exists with its exact name, exact table, and exact command, AND no policy carrying a dedicated RC5.5D policy name exists anywhere else (a same-name policy on a wrong table fails). A missing policy, wrong command, or misplaced name blocks readiness.",
  },
  {
    name: "rls_policy_target_relations_exact",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT (
          SELECT count(*)
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE pol.polname IN (${REQUIRED_RLS_POLICY_NAMES_SQL})
            AND EXISTS (
              SELECT 1 FROM (VALUES ${REQUIRED_RLS_POLICY_VALUES}) AS req(sch, rel, polname, cmd)
              WHERE req.sch = n.nspname AND req.rel = c.relname AND req.polname = pol.polname
            )
        ) = ${REQUIRED_RLS_POLICIES.length}
        AND (
          SELECT count(*) FROM pg_catalog.pg_policy pol
          WHERE pol.polname IN (${REQUIRED_RLS_POLICY_NAMES_SQL})
        ) = ${REQUIRED_RLS_POLICIES.length}
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The ten dedicated policy names attach to EXACTLY their intended relations: exactly ten dedicated-name policies exist database-wide and every one sits on its exact (schema, table). A dedicated name reused on any other relation fails.",
  },
  {
    name: "rls_required_policies_are_permissive",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM (VALUES ${REQUIRED_RLS_POLICY_VALUES}) AS req(sch, rel, polname, cmd)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy pol
            JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = req.sch AND c.relname = req.rel
              AND pol.polname = req.polname
              AND pol.polpermissive
          )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Every required RC5.5D policy is PERMISSIVE (`pg_policy.polpermissive = true`). A RESTRICTIVE policy with the correct name, role, command, and predicate still fails — restrictive policies AND together and would make the boundary inoperable rather than operable.",
  },
  {
    name: "rls_required_policy_roles_exact",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM (VALUES ${REQUIRED_RLS_POLICY_VALUES}) AS req(sch, rel, polname, cmd)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy pol
            JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = req.sch AND c.relname = req.rel
              AND pol.polname = req.polname
              AND pol.polroles = ARRAY[ow.oid]::pg_catalog.oid[]
          )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Every required policy's role set is EXACTLY `{forever_import_execution_owner}` — proven by oid-array equality against `polroles`, not by membership of the owner OID somewhere in the array. Owner-plus-authenticated, owner-plus-anon, owner-plus-service_role, owner-plus-any-custom-role, PUBLIC (OID 0), and an empty/other role set all fail.",
  },
  {
    name: "rls_required_select_expressions_exact",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM (VALUES ${REQUIRED_RLS_SELECT_VALUES}) AS req(sch, rel, polname)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy pol
            JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = req.sch AND c.relname = req.rel
              AND pol.polname = req.polname
              AND pol.polcmd::pg_catalog.text = 'r'
              AND pol.polqual IS NOT NULL
              AND ${NORMALIZED_POLQUAL} IN (${CONSTANT_TRUE_FORMS_SQL})
              AND pol.polwithcheck IS NULL
          )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Every required SELECT policy has `polqual` rendering EXACTLY the constant true (tightly normalized: only `true`/`(true)`; `false`, helper calls, session settings, subqueries, and any expression merely containing the word true all fail) and NO `polwithcheck` expression.",
  },
  {
    name: "rls_required_insert_expressions_exact",
    classification: "rls_requirement",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1 FROM (VALUES ${REQUIRED_RLS_INSERT_VALUES}) AS req(sch, rel, polname)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy pol
            JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = req.sch AND c.relname = req.rel
              AND pol.polname = req.polname
              AND pol.polcmd::pg_catalog.text = 'a'
              AND pol.polqual IS NULL
              AND pol.polwithcheck IS NOT NULL
              AND ${NORMALIZED_POLWITHCHECK} IN (${CONSTANT_TRUE_FORMS_SQL})
          )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "Every required INSERT policy has NO `polqual` expression and a `polwithcheck` rendering EXACTLY the constant true (tightly normalized; `WITH CHECK (false)`, helper calls, and any non-constant expression fail).",
  },
  // ----- Exact applicable-policy classification (Review 11) ------------------
  {
    name: "rls_no_unclassified_applicable_policy",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE (n.nspname, c.relname) IN (VALUES ${ALL_TARGET_RELATION_VALUES})
            AND ${POLICY_APPLIES_TO_OWNER_SQL}
            AND NOT EXISTS (
              SELECT 1 FROM (VALUES ${REQUIRED_RLS_POLICY_VALUES}) AS req(sch, rel, polname, cmd)
              WHERE req.sch = n.nspname AND req.rel = c.relname AND req.polname = pol.polname
                AND ${REQUIRED_POLICY_DEFINITION_MATCH_SQL}
            )
            AND NOT EXISTS (
              SELECT 1 FROM (VALUES ${APPROVED_PREEXISTING_POLICY_VALUES}) AS app(sch, rel, polname, expr_a, expr_b)
              WHERE app.sch = n.nspname AND app.rel = c.relname AND app.polname = pol.polname
                AND pol.polcmd::pg_catalog.text = 'r'
                AND pol.polpermissive
                AND pol.polroles = ARRAY[0]::pg_catalog.oid[]
                AND pol.polqual IS NOT NULL
                AND ${NORMALIZED_POLQUAL} IN (app.expr_a, app.expr_b)
                AND pol.polwithcheck IS NULL
            )
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "EXACT applicable-policy classification: every policy on the six target tables that applies to the execution owner — through the owner OID directly, through PUBLIC (polroles containing OID 0), or through any transitive membership — matches the COMPLETE definition of either a required RC5.5D policy or an individually-enumerated approved pre-existing PUBLIC read policy (exact name, table, command, PERMISSIVE, exact role set, exact normalized expressions). ANY other applicable policy — including a new harmless-looking SELECT policy or a definition-drifted known name — is unclassified and blocks readiness until the Owner classifies it.",
  },
  {
    name: "rls_no_applicable_update_delete_or_all_policy",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE (n.nspname, c.relname) IN (VALUES ${ALL_TARGET_RELATION_VALUES})
            AND pol.polcmd IN ('w','d','*')
            AND ${POLICY_APPLIES_TO_OWNER_SQL}
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "No UPDATE, DELETE, or ALL policy on any target table applies to the execution owner through ANY path — owner OID, PUBLIC (OID 0), or transitive membership. The import surface stays read-and-insert only even if a broad policy is added for other principals via PUBLIC.",
  },
  {
    name: "rls_no_applicable_restrictive_policy",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE (n.nspname, c.relname) IN (VALUES ${ALL_TARGET_RELATION_VALUES})
            AND NOT pol.polpermissive
            AND ${POLICY_APPLIES_TO_OWNER_SQL}
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "No RESTRICTIVE policy on any target table applies to the execution owner through any path. Restrictive policies AND together with the permissive set, so the existence of the expected permissive policies is NOT sufficient — one applicable restrictive policy could silently deny every required row and make the boundary inoperable.",
  },
  {
    name: "rls_no_public_write_policy",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy pol
          JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE (n.nspname, c.relname) IN (VALUES ${ALL_TARGET_RELATION_VALUES})
            AND pol.polcmd IN ('a','w','d','*')
            AND 0::pg_catalog.oid = ANY (pol.polroles)
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "No INSERT, UPDATE, DELETE, or ALL policy on any target table names the implicit PUBLIC pseudo-group (polroles containing OID 0). A PUBLIC write policy would apply to every role in the database — including the owner and the executor — and is never acceptable on the import surface.",
  },
  {
    name: "rls_owner_does_not_own_target_tables",
    classification: "must_be_absent",
    sql: q(`
      SELECT COALESCE((
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE (n.nspname, c.relname) IN (VALUES ${ALL_TARGET_RELATION_VALUES})
            AND c.relowner = ow.oid
        )
        FROM ${OWNER} WHERE ${OWNER_WHERE}
      ), false) AS ok
    `),
    rationale:
      "The execution owner owns NONE of the six target application tables (it accesses them by grant + policy only, never by ownership) — so RLS is never bypassed via table ownership.",
  },
]);

export interface EffectivePrivilegeAuditResult {
  /** True only when every defined check was observed and passed. */
  ready: boolean;
  /** Names of checks that were missing from the observed results. */
  missing: string[];
  /** Names of checks whose observed `ok` was not true (any classification). */
  failed: string[];
  /**
   * Failed/missing checks that are genuine least-privilege leaks or absent
   * required capabilities — never expected on a correctly-migrated target
   * (`required` / `must_be_absent`).
   */
  failedUnexpected: string[];
  /**
   * Failed checks that are PUBLIC-derived / ambient / execution-chain conditions
   * a stock target commonly presents (`blocking_unless_reconciled`). These block
   * readiness but are cleared by a separate Owner-approved reconciliation, not by
   * fixing the migration.
   */
  failedReconciliation: string[];
  /**
   * Failed `required_capability` checks: a required effective privilege the owner
   * MUST hold is missing — the boundary is safe but INOPERABLE (would fail with a
   * permission error). A distinct category from a least-privilege leak.
   */
  failedRequiredCapability: string[];
  /**
   * Failed `rls_requirement` checks: Row-Level-Security incompatibility — a
   * required owner-scoped policy / RLS state is missing, so the owner cannot
   * SELECT/INSERT under RLS without BYPASSRLS. A distinct operability category.
   */
  failedRlsRequirement: string[];
}

const CLASSIFICATION_BY_NAME: ReadonlyMap<string, PrivilegeClassification> = new Map(
  EFFECTIVE_PRIVILEGE_AUDIT.map((check) => [check.name, check.classification]),
);

/**
 * Pure evaluator: scores an observed result set (check name → observed `ok`)
 * against {@link EFFECTIVE_PRIVILEGE_AUDIT}. Readiness requires that EVERY
 * defined check is present and observed `true` — a missing check cannot prove
 * absence, so it blocks readiness. Failures are partitioned by classification
 * so the report can distinguish a genuine leak (`failedUnexpected`) from an
 * expected option-B reconciliation item (`failedReconciliation`). This never
 * connects to a database.
 */
export function evaluateEffectivePrivilegeAudit(
  observed: Record<string, boolean | undefined>,
): EffectivePrivilegeAuditResult {
  const missing: string[] = [];
  const failed: string[] = [];
  const failedUnexpected: string[] = [];
  const failedReconciliation: string[] = [];
  const failedRequiredCapability: string[] = [];
  const failedRlsRequirement: string[] = [];
  for (const check of EFFECTIVE_PRIVILEGE_AUDIT) {
    const value = observed[check.name];
    if (value === undefined) {
      // A missing observation cannot prove anything and blocks readiness. It is
      // bucketed by the check's own classification so the report stays truthful.
      missing.push(check.name);
      if (check.classification === "required_capability") failedRequiredCapability.push(check.name);
      else if (check.classification === "rls_requirement") failedRlsRequirement.push(check.name);
      else if (check.classification === "blocking_unless_reconciled")
        failedReconciliation.push(check.name);
      else failedUnexpected.push(check.name);
    } else if (value !== true) {
      failed.push(check.name);
      if (check.classification === "required_capability") failedRequiredCapability.push(check.name);
      else if (check.classification === "rls_requirement") failedRlsRequirement.push(check.name);
      else if (check.classification === "blocking_unless_reconciled")
        failedReconciliation.push(check.name);
      else failedUnexpected.push(check.name);
    }
  }
  return {
    ready: missing.length === 0 && failed.length === 0,
    missing,
    failed,
    failedUnexpected,
    failedReconciliation,
    failedRequiredCapability,
    failedRlsRequirement,
  };
}

/** The exact set of check names, for exhaustiveness assertions by callers. */
export function effectivePrivilegeCheckNames(): string[] {
  return EFFECTIVE_PRIVILEGE_AUDIT.map((check) => check.name);
}

/** Check names carrying a given classification. */
export function effectivePrivilegeChecksByClassification(
  classification: PrivilegeClassification,
): string[] {
  return EFFECTIVE_PRIVILEGE_AUDIT.filter((c) => c.classification === classification).map(
    (c) => c.name,
  );
}

/** The classification of a named check, or undefined if the name is unknown. */
export function classificationOf(name: string): PrivilegeClassification | undefined {
  return CLASSIFICATION_BY_NAME.get(name);
}
