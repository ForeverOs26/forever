import { describe, expect, it } from "vitest";

import {
  ALL_TARGET_RELATIONS,
  APPROVED_PREEXISTING_READ_POLICIES,
  APPROVED_REQUIRED_SCHEMAS,
  BOUNDARY_OWNED_SCHEMAS,
  BOUNDARY_RELATIONS,
  BOUNDARY_ROUTINES,
  BOUNDARY_SEQUENCES,
  BROAD_PLATFORM_ROLES,
  classificationOf,
  classifySchema,
  classifyTargetTablePolicy,
  CONSTANT_TRUE_NORMALIZED_FORMS,
  EFFECTIVE_PRIVILEGE_AUDIT,
  effectivePrivilegeCheckNames,
  effectivePrivilegeChecksByClassification,
  evaluateEffectivePrivilegeAudit,
  EXECUTION_OWNER_ROLE,
  EXECUTION_SCHEMA,
  EXECUTION_WRAPPER_SIGNATURE,
  EXECUTOR_ROLE,
  EXPLICITLY_PROHIBITED_SCHEMAS,
  IMPORT_TARGET_RELATIONS,
  isBroadPlatformRole,
  isConstantTruePolicyExpression,
  isNonSystemSchema,
  isSystemSchema,
  normalizePolicyExpression,
  type ObservedTargetTablePolicy,
  OWNER_TARGET_RELATION_PRIVILEGES,
  policyAppliesToExecutionOwner,
  PUBLIC_SCHEMA_USAGE_POLICY,
  REQUIRED_RLS_POLICIES,
  SYSTEM_SCHEMA_EXACT,
  SYSTEM_SCHEMA_PREFIXES,
} from "./effective-privilege-audit";

/** A baseline observed result set where every check passes (clean target). */
function allPassing(): Record<string, boolean> {
  return Object.fromEntries(effectivePrivilegeCheckNames().map((name) => [name, true]));
}

/** Checks that scan EVERY non-system schema via the exclusion predicate. */
const WHOLE_SURFACE_CHECKS = [
  "executor_no_table_privileges_in_non_system_schemas",
  "executor_no_sequence_privileges_in_non_system_schemas",
  "executor_no_create_on_non_system_schemas",
  "executor_no_routine_execute_outside_wrapper",
  "executor_no_security_definer_execute_outside_wrapper",
  "executor_no_usage_on_unexpected_non_system_schema",
  "no_unexpected_non_system_schema",
];

describe("RC5.5D effective-privilege audit: contract shape", () => {
  it("targets the dedicated schema and role, not public", () => {
    expect(EXECUTOR_ROLE).toBe("forever_import_executor");
    expect(EXECUTION_SCHEMA).toBe("forever_execution");
    expect(EXECUTION_WRAPPER_SIGNATURE).toBe(
      "forever_execution.forever_execute_approved_import(jsonb)",
    );
  });

  it("declares option B: public-schema USAGE is blocking, never silently assumed absent", () => {
    expect(PUBLIC_SCHEMA_USAGE_POLICY).toBe("blocking");
  });

  it("declares the required capabilities plus existence anchors, and the rest as forbidden", () => {
    const required = effectivePrivilegeChecksByClassification("required");
    expect(required.sort()).toEqual(
      [
        "execution_wrapper_exists",
        "executor_can_execute_wrapper",
        "executor_has_execution_schema_usage",
        "executor_role_exists",
      ].sort(),
    );
    const forbidden = [
      ...effectivePrivilegeChecksByClassification("must_be_absent"),
      ...effectivePrivilegeChecksByClassification("blocking_unless_reconciled"),
    ];
    expect(forbidden.length).toBeGreaterThanOrEqual(20);
  });

  it("classifies PUBLIC-derived / ambient / execution-chain conditions as blocking_unless_reconciled", () => {
    const reconciliation = effectivePrivilegeChecksByClassification("blocking_unless_reconciled");
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        "executor_no_effective_public_schema_usage",
        "public_schema_grants_no_public_usage",
        "executor_no_database_temp",
        "executor_no_routine_execute_outside_wrapper",
        "executor_no_security_definer_execute_outside_wrapper",
        "executor_no_usage_on_unexpected_non_system_schema",
        "no_unexpected_non_system_schema",
        "execution_chain_wrapper_owner_not_broad",
        "execution_chain_internal_routine_owners_not_broad",
      ]),
    );
    for (const name of reconciliation) {
      expect(classificationOf(name)).toBe("blocking_unless_reconciled");
    }
  });
});

describe("RC5.5D effective-privilege audit: explicit system-schema exclusion policy", () => {
  it("excludes ONLY the allowlisted system schemas and temp/toast prefixes", () => {
    expect([...SYSTEM_SCHEMA_EXACT]).toEqual(["pg_catalog", "information_schema", "pg_toast"]);
    expect([...SYSTEM_SCHEMA_PREFIXES]).toEqual(["pg_temp_", "pg_toast_temp_", "pg_toast_"]);
    for (const name of ["pg_catalog", "information_schema", "pg_toast"]) {
      expect(isSystemSchema(name)).toBe(true);
    }
    for (const name of ["pg_temp_5", "pg_toast_temp_9", "pg_toast_1234"]) {
      expect(isSystemSchema(name)).toBe(true);
    }
  });

  it("audits every non-system schema — Supabase / extension / application schemas are NOT system", () => {
    for (const name of [
      "public",
      "forever_execution",
      "forever_import",
      "auth",
      "storage",
      "extensions",
      "graphql",
      "vault",
      "app_private",
      "custom_tools",
    ]) {
      expect(isSystemSchema(name)).toBe(false);
      expect(isNonSystemSchema(name)).toBe(true);
    }
  });

  it("does NOT exclude a deceptive schema name such as pg_catalog_evil", () => {
    expect(isSystemSchema("pg_catalog_evil")).toBe(false);
    expect(isSystemSchema("pg_catalogevil")).toBe(false);
    expect(isSystemSchema("information_schema_x")).toBe(false);
    expect(isSystemSchema("pg_toaster")).toBe(false); // not the pg_toast_ prefix
    expect(isNonSystemSchema("pg_catalog_evil")).toBe(true);
  });
});

describe("RC5.5D effective-privilege audit: explicit schema classification (blocker 3)", () => {
  it("classifies every non-system schema into exactly one surface", () => {
    expect(classifySchema("pg_catalog")).toBe("system");
    expect(classifySchema("pg_temp_9")).toBe("system");
    expect(classifySchema("forever_execution")).toBe("approved_required_surface");
    expect(classifySchema("public")).toBe("explicitly_prohibited_surface");
    expect(classifySchema("forever_import")).toBe("explicitly_prohibited_surface");
    for (const name of ["auth", "storage", "extensions", "graphql", "vault"]) {
      expect(classifySchema(name)).toBe("explicitly_prohibited_surface");
    }
  });

  it("a newly introduced schema is unexpected_surface (must be explicitly classified)", () => {
    expect(classifySchema("app_private")).toBe("unexpected_surface");
    expect(classifySchema("custom_tools")).toBe("unexpected_surface");
    expect(classifySchema("brand_new_schema")).toBe("unexpected_surface");
  });

  it("the approved and prohibited lists are disjoint and cover the boundary schemas", () => {
    expect([...APPROVED_REQUIRED_SCHEMAS]).toEqual(["forever_execution"]);
    expect(EXPLICITLY_PROHIBITED_SCHEMAS).toContain("public");
    expect(EXPLICITLY_PROHIBITED_SCHEMAS).toContain("forever_import");
    for (const s of APPROVED_REQUIRED_SCHEMAS) {
      expect(EXPLICITLY_PROHIBITED_SCHEMAS).not.toContain(s);
    }
  });

  it("the unexpected-schema check blocks readiness and is derived from the classification lists", () => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "no_unexpected_non_system_schema",
    );
    expect(check).toBeDefined();
    expect(check!.classification).toBe("blocking_unless_reconciled");
    for (const s of [...APPROVED_REQUIRED_SCHEMAS, ...EXPLICITLY_PROHIBITED_SCHEMAS]) {
      expect(check!.sql).toContain(`'${s}'`);
    }
    const observed = allPassing();
    observed.no_unexpected_non_system_schema = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failedReconciliation).toContain("no_unexpected_non_system_schema");
  });
});

describe("RC5.5D effective-privilege audit: any-routine EXECUTE (blocker 1)", () => {
  it("audits ANY routine kind, not only SECURITY DEFINER, across all non-system schemas", () => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "executor_no_routine_execute_outside_wrapper",
    );
    expect(check).toBeDefined();
    // functions, procedures, aggregates, window routines.
    expect(check!.sql).toContain("p.prokind IN ('f','p','a','w')");
    // spans every non-system schema...
    expect(check!.sql).toContain(
      "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    );
    // ...and excludes exactly the wrapper.
    expect(check!.sql).toContain("forever_execute_approved_import");
    expect(check!.sql).toContain("has_function_privilege(r.oid, p.oid, 'EXECUTE')");
    // It is NOT restricted to prosecdef routines.
    expect(check!.sql).not.toContain("p.prosecdef");
  });

  it("any executable routine outside the wrapper blocks readiness", () => {
    const observed = allPassing();
    observed.executor_no_routine_execute_outside_wrapper = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failedReconciliation).toContain("executor_no_routine_execute_outside_wrapper");
  });
});

describe("RC5.5D effective-privilege audit: complete execution chain (blocker 2)", () => {
  it("enumerates the broad/dangerous platform roles that may not own the chain", () => {
    expect(BROAD_PLATFORM_ROLES).toEqual(
      expect.arrayContaining(["postgres", "service_role", "pg_read_all_data", "pg_write_all_data"]),
    );
    expect(isBroadPlatformRole("postgres")).toBe(true);
    expect(isBroadPlatformRole("service_role")).toBe(true);
    expect(isBroadPlatformRole("forever_import_executor")).toBe(false);
  });

  it("classifies the SECURITY DEFINER transition target (wrapper owner) and rejects broad owners", () => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "execution_chain_wrapper_owner_not_broad",
    );
    expect(check).toBeDefined();
    expect(check!.sql).toContain("p.proowner");
    expect(check!.sql).toContain("o.rolsuper");
    expect(check!.sql).toContain("o.rolbypassrls");
    expect(check!.sql).toContain("'postgres'");
    expect(check!.sql).toContain("'service_role'");
    // Also rejects a role that is a MEMBER of a broad/superuser role.
    expect(check!.sql).toContain("pg_auth_members");
  });

  it("classifies internal-routine owners across the private and execution schemas", () => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "execution_chain_internal_routine_owners_not_broad",
    );
    expect(check).toBeDefined();
    expect(check!.sql).toContain("n.nspname IN ('forever_import', 'forever_execution')");
    expect(check!.sql).toContain("p.proowner");
    expect(check!.sql).toContain("o.rolsuper");
  });

  it("confirms the executor is a dedicated LOGIN role with no ambient authority", () => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "execution_chain_executor_is_dedicated_login_role",
    );
    expect(check).toBeDefined();
    expect(check!.sql).toContain("r.rolcanlogin");
    expect(check!.sql).toContain("NOT r.rolsuper");
    expect(check!.sql).toContain("NOT r.rolinherit");
    expect(check!.sql).toContain("NOT r.rolbypassrls");
  });

  it.each([
    ["a broad wrapper owner", "execution_chain_wrapper_owner_not_broad", "reconciliation"],
    [
      "a broad internal-routine owner",
      "execution_chain_internal_routine_owners_not_broad",
      "reconciliation",
    ],
    [
      "a non-minimal executor login role",
      "execution_chain_executor_is_dedicated_login_role",
      "unexpected",
    ],
  ])("blocks readiness on %s", (_label, checkName, bucket) => {
    const observed = allPassing();
    observed[checkName] = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain(checkName);
    if (bucket === "reconciliation") {
      expect(result.failedReconciliation).toContain(checkName);
    } else {
      expect(result.failedUnexpected).toContain(checkName);
    }
  });
});

describe("RC5.5D effective-privilege audit: valid, read-only, fail-closed SQL", () => {
  it("every check is a single read-only SELECT returning exactly one boolean ok", () => {
    for (const check of EFFECTIVE_PRIVILEGE_AUDIT) {
      expect(check.sql.startsWith("SELECT ")).toBe(true);
      expect(check.sql).toMatch(/\bAS ok\b/);
      // A single statement only.
      expect(check.sql.replace(/;$/, "")).not.toContain(";");
      // No mutation/DDL keyword as an actual statement (privilege NAMES like
      // 'INSERT' appear only as quoted string arguments; strip literals first).
      const withoutLiterals = check.sql.replace(/'[^']*'/g, "''");
      expect(withoutLiterals).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/,
      );
      // Schema-qualified catalog access only.
      expect(check.sql).toMatch(/pg_catalog\./);
    }
  });

  it("NEVER passes 'public' (a pseudo-group) as a role argument to has_*_privilege", () => {
    for (const check of EFFECTIVE_PRIVILEGE_AUDIT) {
      const calls = check.sql.match(/has_\w+_privilege\(\s*[^,]+/g) ?? [];
      for (const call of calls) {
        // Role argument is an OID — executor (r.oid) or execution owner (ow.oid).
        expect(call).toMatch(/has_\w+_privilege\(\s*(r|ow)\.oid\b/);
        expect(call).not.toMatch(/has_\w+_privilege\(\s*'/);
      }
    }
  });

  it("inspects PUBLIC ACL state via aclexplode + acldefault and the PUBLIC grantee OID 0", () => {
    const aclChecks = EFFECTIVE_PRIVILEGE_AUDIT.filter((c) => c.sql.includes("aclexplode"));
    expect(aclChecks.map((c) => c.name).sort()).toEqual(
      [
        "public_execution_schema_usage_grant_absent",
        "public_schema_grants_no_public_usage",
        "public_wrapper_execute_grant_absent",
      ].sort(),
    );
    for (const check of aclChecks) {
      expect(check.sql).toContain("aclexplode");
      expect(check.sql).toMatch(/COALESCE\([^)]*acldefault\(/);
      expect(check.sql).toContain("a.grantee = 0");
    }
  });

  it("fails closed: every check resolves role/object by join and defaults to false when absent", () => {
    for (const check of EFFECTIVE_PRIVILEGE_AUDIT) {
      if (check.name === "executor_role_exists" || check.name === "execution_wrapper_exists") {
        expect(check.sql).toMatch(/SELECT EXISTS \(/);
      } else {
        expect(check.sql).toContain(", false) AS ok");
        if (check.name.startsWith("executor_")) {
          expect(check.sql).toContain("pg_catalog.pg_roles r");
        }
      }
    }
  });
});

describe("RC5.5D effective-privilege audit: whole non-system database surface", () => {
  it("declares the whole-surface capability checks", () => {
    const names = effectivePrivilegeCheckNames();
    expect(names).toEqual(expect.arrayContaining(WHOLE_SURFACE_CHECKS));
  });

  it("each whole-surface check scans EVERY non-system schema (system schemas excluded by the allowlist)", () => {
    for (const name of WHOLE_SURFACE_CHECKS) {
      const check = EFFECTIVE_PRIVILEGE_AUDIT.find((c) => c.name === name);
      expect(check, name).toBeDefined();
      const sql = check!.sql;
      expect(sql).toContain("n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')");
      expect(sql).toContain("n.nspname !~ '^pg_temp_'");
      expect(sql).toContain("n.nspname !~ '^pg_toast_temp_'");
      expect(sql).toContain("n.nspname !~ '^pg_toast_'");
      expect(sql).not.toMatch(/nspname IN \('public', 'forever_import', 'forever_execution'\)/);
    }
  });

  it("the table check covers all relkinds and all seven table privileges", () => {
    const sql = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "executor_no_table_privileges_in_non_system_schemas",
    )!.sql;
    expect(sql).toContain("c.relkind IN ('r','p','v','m','f')");
    for (const priv of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ]) {
      expect(sql).toContain(`'${priv}'`);
    }
  });
});

describe("RC5.5D effective-privilege audit: evaluator and PUBLIC-inheritance", () => {
  it("is ready only when every check is present and passes", () => {
    expect(evaluateEffectivePrivilegeAudit(allPassing())).toEqual({
      ready: true,
      missing: [],
      failed: [],
      failedUnexpected: [],
      failedReconciliation: [],
      failedRequiredCapability: [],
      failedRlsRequirement: [],
    });
  });

  it("blocks readiness when any check is missing (absence must be proven, not assumed)", () => {
    const observed = allPassing();
    delete observed.executor_no_forever_import_schema_usage;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("executor_no_forever_import_schema_usage");
    expect(result.failedUnexpected).toContain("executor_no_forever_import_schema_usage");
  });

  it("a direct REVOKE from the executor cannot override PUBLIC — only the observation counts", () => {
    const observed = allPassing();
    observed.executor_no_effective_public_schema_usage = false;
    observed.public_schema_grants_no_public_usage = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failedReconciliation).toEqual(
      expect.arrayContaining([
        "executor_no_effective_public_schema_usage",
        "public_schema_grants_no_public_usage",
      ]),
    );
    expect(result.failedUnexpected).not.toContain("executor_no_effective_public_schema_usage");
  });

  it.each([
    [
      "DML on a table in another schema (e.g. app_private)",
      "executor_no_table_privileges_in_non_system_schemas",
      "unexpected",
    ],
    [
      "a sequence privilege in another schema (e.g. storage)",
      "executor_no_sequence_privileges_in_non_system_schemas",
      "unexpected",
    ],
    [
      "CREATE on another schema (e.g. custom_tools)",
      "executor_no_create_on_non_system_schemas",
      "unexpected",
    ],
    [
      "an executable routine in another schema (e.g. extensions)",
      "executor_no_routine_execute_outside_wrapper",
      "reconciliation",
    ],
    [
      "a SECURITY DEFINER routine in another schema",
      "executor_no_security_definer_execute_outside_wrapper",
      "reconciliation",
    ],
    [
      "USAGE on an unexpected schema (e.g. storage)",
      "executor_no_usage_on_unexpected_non_system_schema",
      "reconciliation",
    ],
  ])("blocks readiness when %s is observed", (_label, checkName, bucket) => {
    const observed = allPassing();
    observed[checkName] = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain(checkName);
    if (bucket === "reconciliation") {
      expect(result.failedReconciliation).toContain(checkName);
    } else {
      expect(result.failedUnexpected).toContain(checkName);
    }
  });

  it.each([
    ["PUBLIC USAGE on the execution schema", "public_execution_schema_usage_grant_absent"],
    ["PUBLIC EXECUTE still granted on the wrapper", "public_wrapper_execute_grant_absent"],
    [
      "a second executor-executable function in the execution schema",
      "executor_no_other_executable_function_in_execution_schema",
    ],
    ["any forever_import USAGE (direct or PUBLIC)", "executor_no_forever_import_schema_usage"],
    ["DML on the durable approval/receipt storage", "executor_no_forever_import_table_dml"],
    ["a role membership / SET ROLE path", "executor_has_no_role_memberships"],
    ["a database CREATE privilege", "executor_no_database_create"],
    ["ownership of a schema", "executor_owns_no_schema"],
    ["ownership of a table/sequence", "executor_owns_no_relation"],
    ["ownership of a routine", "executor_owns_no_routine"],
  ])("fails the audit (as an unexpected leak) when %s is observed", (_label, checkName) => {
    const observed = allPassing();
    observed[checkName] = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain(checkName);
    expect(result.failedUnexpected).toContain(checkName);
  });

  it("the approved wrapper remains the sole allowed privileged callable surface", () => {
    const observed = allPassing();
    observed.executor_can_execute_wrapper = true;
    observed.executor_no_routine_execute_outside_wrapper = false;
    expect(evaluateEffectivePrivilegeAudit(observed).ready).toBe(false);
  });

  it("a PUBLIC-derived database TEMP is classified explicitly as a reconciliation item", () => {
    const observed = allPassing();
    observed.executor_no_database_temp = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failedReconciliation).toContain("executor_no_database_temp");
  });

  it("fails when a required capability or existence anchor is absent", () => {
    for (const name of [
      "executor_role_exists",
      "execution_wrapper_exists",
      "executor_has_execution_schema_usage",
      "executor_can_execute_wrapper",
    ]) {
      const observed = allPassing();
      observed[name] = false;
      const result = evaluateEffectivePrivilegeAudit(observed);
      expect(result.ready).toBe(false);
      expect(result.failed).toContain(name);
      expect(result.failedUnexpected).toContain(name);
    }
  });
});

describe("RC5.5D effective-privilege audit: dedicated execution owner (review 9)", () => {
  const OWNER_IDENTITY_CHECKS = [
    "execution_owner_role_exists",
    "execution_owner_role_is_exact_no_login_role",
    "execution_owner_has_no_direct_memberships",
    "execution_owner_has_no_transitive_memberships",
    "execution_owner_has_no_set_role_path",
  ];
  const OWNERSHIP_CHECKS = [
    "wrapper_owned_by_exact_execution_owner",
    "internal_routines_owned_by_exact_execution_owner",
    "boundary_relations_owned_by_exact_execution_owner",
    "boundary_sequences_owned_by_exact_execution_owner",
    "execution_owner_owns_no_unexpected_schema",
    "execution_owner_owns_no_unexpected_relation",
    "execution_owner_owns_no_unexpected_sequence",
    "execution_owner_owns_no_unexpected_routine",
    "execution_owner_owns_no_database",
  ];
  const INVENTORY_CHECKS = [
    "execution_boundary_routine_inventory_exact",
    "execution_boundary_relation_inventory_exact",
    "execution_boundary_sequence_inventory_exact",
  ];
  const CAPABILITY_CHECKS = [
    "execution_owner_has_only_approved_schema_privileges",
    "execution_owner_has_only_approved_relation_privileges",
    "execution_owner_has_only_approved_sequence_privileges",
    "execution_owner_has_only_approved_routine_execute",
    "execution_owner_no_database_create",
    "execution_owner_no_database_temp",
  ];

  it("exposes the exact owner role and boundary inventories", () => {
    expect(EXECUTION_OWNER_ROLE).toBe("forever_import_execution_owner");
    expect([...BOUNDARY_OWNED_SCHEMAS]).toEqual(["forever_import", "forever_execution"]);
    expect(BOUNDARY_ROUTINES).toHaveLength(6);
    expect(BOUNDARY_RELATIONS).toHaveLength(2);
    expect(BOUNDARY_SEQUENCES).toHaveLength(0); // UUID keys, no sequences
    // Exactly one SECURITY DEFINER routine (the wrapper) in the inventory.
    expect(BOUNDARY_ROUTINES.filter((r) => r.securityDefiner).map((r) => r.name)).toEqual([
      "forever_execute_approved_import",
    ]);
    // The target allowlist is read-only on dependencies, SELECT+INSERT on imports.
    expect(OWNER_TARGET_RELATION_PRIVILEGES["public.developers"]).toEqual(["SELECT"]);
    expect(OWNER_TARGET_RELATION_PRIVILEGES["public.projects"]).toEqual(["SELECT", "INSERT"]);
    for (const privs of Object.values(OWNER_TARGET_RELATION_PRIVILEGES)) {
      expect(privs).not.toContain("UPDATE");
      expect(privs).not.toContain("DELETE");
    }
  });

  it("declares all owner identity/ownership/inventory/capability checks", () => {
    const names = effectivePrivilegeCheckNames();
    for (const n of [
      ...OWNER_IDENTITY_CHECKS,
      ...OWNERSHIP_CHECKS,
      ...INVENTORY_CHECKS,
      ...CAPABILITY_CHECKS,
    ]) {
      expect(names, n).toContain(n);
    }
  });

  it("the wrapper-owner check requires the EXACT owner (not merely 'not broad')", () => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "wrapper_owned_by_exact_execution_owner",
    );
    expect(check!.sql).toContain("o.rolname = 'forever_import_execution_owner'");
    expect(check!.sql).toContain("p.proowner");
  });

  it("the transitive-membership and SET ROLE checks use recursive traversal", () => {
    for (const name of [
      "execution_owner_has_no_transitive_memberships",
      "execution_owner_has_no_set_role_path",
    ]) {
      const check = EFFECTIVE_PRIVILEGE_AUDIT.find((c) => c.name === name);
      expect(check!.sql).toContain("WITH RECURSIVE");
      expect(check!.sql).toContain("pg_auth_members");
    }
  });

  it("the owner role-shape check requires NOLOGIN and minimal flags", () => {
    const sql = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "execution_owner_role_is_exact_no_login_role",
    )!.sql;
    expect(sql).toContain("NOT ow.rolcanlogin");
    expect(sql).toContain("NOT ow.rolsuper");
    expect(sql).toContain("NOT ow.rolinherit");
    expect(sql).toContain("NOT ow.rolbypassrls");
  });

  it("the routine-inventory check pins schema, name, identity args, prokind, and secdef", () => {
    const sql = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "execution_boundary_routine_inventory_exact",
    )!.sql;
    expect(sql).toContain("pg_get_function_identity_arguments");
    expect(sql).toContain("p.prokind::text");
    expect(sql).toContain("p.prosecdef");
    // Each inventory routine appears by name.
    for (const r of BOUNDARY_ROUTINES) {
      expect(sql).toContain(`'${r.name}'`);
    }
  });

  it("the relation-privilege allowlist forbids UPDATE/DELETE/TRUNCATE on the import tables", () => {
    const sql = EFFECTIVE_PRIVILEGE_AUDIT.find(
      (c) => c.name === "execution_owner_has_only_approved_relation_privileges",
    )!.sql;
    // The allowlist is built from the target-privilege map, forbidding the rest.
    expect(sql).toContain("has_table_privilege(ow.oid");
    expect(sql).toContain("'public'");
    expect(sql).toContain("projects");
  });

  it.each([
    // identity / ownership / inventory violations are unexpected leaks
    ["missing owner role", "execution_owner_role_exists", "unexpected"],
    [
      "owner with LOGIN or non-minimal flags",
      "execution_owner_role_is_exact_no_login_role",
      "unexpected",
    ],
    ["owner with a direct membership", "execution_owner_has_no_direct_memberships", "unexpected"],
    [
      "owner with a nested membership",
      "execution_owner_has_no_transitive_memberships",
      "unexpected",
    ],
    ["owner with a broad SET ROLE path", "execution_owner_has_no_set_role_path", "unexpected"],
    ["wrapper owned by another role", "wrapper_owned_by_exact_execution_owner", "unexpected"],
    [
      "internal routine owned by another role",
      "internal_routines_owned_by_exact_execution_owner",
      "unexpected",
    ],
    [
      "a boundary table owned by another role",
      "boundary_relations_owned_by_exact_execution_owner",
      "unexpected",
    ],
    ["extra schema ownership", "execution_owner_owns_no_unexpected_schema", "unexpected"],
    ["extra relation ownership", "execution_owner_owns_no_unexpected_relation", "unexpected"],
    ["extra sequence ownership", "execution_owner_owns_no_unexpected_sequence", "unexpected"],
    ["extra routine ownership", "execution_owner_owns_no_unexpected_routine", "unexpected"],
    ["database ownership", "execution_owner_owns_no_database", "unexpected"],
    [
      "a missing/extra/overloaded routine",
      "execution_boundary_routine_inventory_exact",
      "unexpected",
    ],
    [
      "a missing/extra boundary relation",
      "execution_boundary_relation_inventory_exact",
      "unexpected",
    ],
    [
      "an unexpected boundary sequence",
      "execution_boundary_sequence_inventory_exact",
      "unexpected",
    ],
    ["database CREATE on the owner", "execution_owner_no_database_create", "unexpected"],
    // capability-allowlist violations are reconciliation items (PUBLIC-derived on stock targets)
    [
      "owner schema privilege outside allowlist",
      "execution_owner_has_only_approved_schema_privileges",
      "reconciliation",
    ],
    [
      "owner relation privilege outside allowlist",
      "execution_owner_has_only_approved_relation_privileges",
      "reconciliation",
    ],
    [
      "owner sequence privilege outside allowlist",
      "execution_owner_has_only_approved_sequence_privileges",
      "reconciliation",
    ],
    [
      "owner routine EXECUTE outside call graph",
      "execution_owner_has_only_approved_routine_execute",
      "reconciliation",
    ],
    ["owner database TEMP", "execution_owner_no_database_temp", "reconciliation"],
  ])("blocks readiness on %s", (_label, checkName, bucket) => {
    const observed = Object.fromEntries(effectivePrivilegeCheckNames().map((n) => [n, true]));
    observed[checkName] = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain(checkName);
    if (bucket === "reconciliation") {
      expect(result.failedReconciliation).toContain(checkName);
    } else {
      expect(result.failedUnexpected).toContain(checkName);
    }
  });
});

describe("RC5.5D effective-privilege audit: owner operability & RLS (reviews 10–11)", () => {
  const REQUIRED_CAP_CHECKS = [
    "execution_owner_has_required_public_schema_usage",
    "execution_owner_has_required_developer_select",
    "execution_owner_has_required_location_select",
    "execution_owner_has_required_project_select_insert",
    "execution_owner_has_required_building_select_insert",
    "execution_owner_has_required_unit_select_insert",
    "execution_owner_has_required_price_history_select_insert",
  ];
  const RLS_REQUIREMENT_CHECKS = [
    "rls_target_tables_row_security_enabled",
    "rls_required_policy_inventory_exact",
    "rls_policy_target_relations_exact",
    "rls_required_policies_are_permissive",
    "rls_required_policy_roles_exact",
    "rls_required_select_expressions_exact",
    "rls_required_insert_expressions_exact",
  ];

  it("declares the exact required-capability positive checks, classified as operability", () => {
    const names = effectivePrivilegeCheckNames();
    for (const n of REQUIRED_CAP_CHECKS) {
      expect(names, n).toContain(n);
      expect(classificationOf(n)).toBe("required_capability");
    }
    expect(effectivePrivilegeChecksByClassification("required_capability").sort()).toEqual(
      [...REQUIRED_CAP_CHECKS].sort(),
    );
  });

  it("required-capability checks resolve the exact object by OID and use effective has_*_privilege", () => {
    for (const name of REQUIRED_CAP_CHECKS) {
      const sql = EFFECTIVE_PRIVILEGE_AUDIT.find((c) => c.name === name)!.sql;
      expect(sql).toContain("pg_catalog.has_");
      expect(sql).toMatch(/has_\w+_privilege\(\s*ow\.oid/);
      // Positive checks are NOT the double-negative allowlist form.
      expect(sql).not.toContain("NOT EXISTS");
    }
  });

  it.each([
    ["missing USAGE ON SCHEMA public", "execution_owner_has_required_public_schema_usage"],
    ["missing SELECT ON public.developers", "execution_owner_has_required_developer_select"],
    ["missing SELECT ON public.locations", "execution_owner_has_required_location_select"],
    [
      "missing SELECT/INSERT ON public.projects",
      "execution_owner_has_required_project_select_insert",
    ],
    [
      "missing SELECT/INSERT ON public.buildings",
      "execution_owner_has_required_building_select_insert",
    ],
    ["missing SELECT/INSERT ON public.units", "execution_owner_has_required_unit_select_insert"],
    [
      "missing SELECT/INSERT ON public.unit_price_history",
      "execution_owner_has_required_price_history_select_insert",
    ],
  ])("blocks readiness as a MISSING-CAPABILITY failure when %s", (_label, checkName) => {
    const observed = allPassing();
    observed[checkName] = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain(checkName);
    // Classified as a genuine required-capability failure, NOT a reconciliation item.
    expect(result.failedRequiredCapability).toContain(checkName);
    expect(result.failedReconciliation).not.toContain(checkName);
  });

  it("a missing required capability is not treated as a reconciliation item even when missing entirely", () => {
    const observed = allPassing();
    delete observed.execution_owner_has_required_unit_select_insert;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("execution_owner_has_required_unit_select_insert");
    expect(result.failedRequiredCapability).toContain(
      "execution_owner_has_required_unit_select_insert",
    );
  });

  it("readiness is two-sided: an EXTRA privilege still fails the existing negative allowlist check", () => {
    const observed = allPassing();
    // All positive required capabilities present, but an extra privilege exists.
    observed.execution_owner_has_only_approved_relation_privileges = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failedReconciliation).toContain(
      "execution_owner_has_only_approved_relation_privileges",
    );
  });

  it("declares the RLS operability and applicable-policy checks", () => {
    const names = effectivePrivilegeCheckNames();
    for (const n of [
      ...RLS_REQUIREMENT_CHECKS,
      "rls_no_unclassified_applicable_policy",
      "rls_no_applicable_update_delete_or_all_policy",
      "rls_no_applicable_restrictive_policy",
      "rls_no_public_write_policy",
      "rls_owner_does_not_own_target_tables",
    ]) {
      expect(names, n).toContain(n);
    }
    for (const n of RLS_REQUIREMENT_CHECKS) {
      expect(classificationOf(n)).toBe("rls_requirement");
    }
    for (const n of [
      "rls_no_unclassified_applicable_policy",
      "rls_no_applicable_update_delete_or_all_policy",
      "rls_no_applicable_restrictive_policy",
      "rls_no_public_write_policy",
    ]) {
      expect(classificationOf(n)).toBe("must_be_absent");
    }
    // The Review 10 existence-only proofs are fully superseded by the exact
    // Review 11 definitions — they must not linger as a weaker duplicate path.
    expect(names).not.toContain("rls_owner_has_select_policy_on_all_targets");
    expect(names).not.toContain("rls_owner_has_insert_policy_on_import_targets");
    expect(names).not.toContain("rls_owner_has_no_update_or_delete_policy");
  });

  it.each([
    [
      "target RLS disabled / a target table missing",
      "rls_target_tables_row_security_enabled",
      "rls",
    ],
    [
      "a missing/misplaced/miscommanded required policy",
      "rls_required_policy_inventory_exact",
      "rls",
    ],
    ["a dedicated policy name on a wrong relation", "rls_policy_target_relations_exact", "rls"],
    ["a RESTRICTIVE required policy", "rls_required_policies_are_permissive", "rls"],
    ["a required policy with a non-exact role set", "rls_required_policy_roles_exact", "rls"],
    [
      "a required SELECT policy with a drifted expression",
      "rls_required_select_expressions_exact",
      "rls",
    ],
    [
      "a required INSERT policy with a drifted expression",
      "rls_required_insert_expressions_exact",
      "rls",
    ],
    ["an unclassified applicable policy", "rls_no_unclassified_applicable_policy", "unexpected"],
    [
      "an applicable UPDATE/DELETE/ALL policy",
      "rls_no_applicable_update_delete_or_all_policy",
      "unexpected",
    ],
    ["an applicable RESTRICTIVE policy", "rls_no_applicable_restrictive_policy", "unexpected"],
    ["a PUBLIC write policy", "rls_no_public_write_policy", "unexpected"],
    ["owner owning a target table", "rls_owner_does_not_own_target_tables", "unexpected"],
  ])("blocks readiness on %s", (_label, checkName, bucket) => {
    const observed = allPassing();
    observed[checkName] = false;
    const result = evaluateEffectivePrivilegeAudit(observed);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain(checkName);
    if (bucket === "rls") {
      expect(result.failedRlsRequirement).toContain(checkName);
    } else {
      expect(result.failedUnexpected).toContain(checkName);
    }
  });

  it("a fully safe AND operable target is ready (all positive + negative + RLS pass)", () => {
    expect(evaluateEffectivePrivilegeAudit(allPassing()).ready).toBe(true);
  });
});

describe("RC5.5D RLS exact required-policy inventory (review 11)", () => {
  const EXPECTED_SELECT_NAMES = [
    "forever_import_owner_select_developers",
    "forever_import_owner_select_locations",
    "forever_import_owner_select_projects",
    "forever_import_owner_select_buildings",
    "forever_import_owner_select_units",
    "forever_import_owner_select_unit_price_history",
  ];
  const EXPECTED_INSERT_NAMES = [
    "forever_import_owner_insert_projects",
    "forever_import_owner_insert_buildings",
    "forever_import_owner_insert_units",
    "forever_import_owner_insert_unit_price_history",
  ];

  it("declares exactly the ten dedicated per-table policies", () => {
    expect(REQUIRED_RLS_POLICIES).toHaveLength(10);
    const selects = REQUIRED_RLS_POLICIES.filter((p) => p.command === "SELECT");
    const inserts = REQUIRED_RLS_POLICIES.filter((p) => p.command === "INSERT");
    expect(selects.map((p) => p.name).sort()).toEqual([...EXPECTED_SELECT_NAMES].sort());
    expect(inserts.map((p) => p.name).sort()).toEqual([...EXPECTED_INSERT_NAMES].sort());
    // Derived from the SAME relation inventories as the capability allowlist.
    expect(selects.map((p) => `${p.schema}.${p.table}`).sort()).toEqual(
      [...ALL_TARGET_RELATIONS].sort(),
    );
    expect(inserts.map((p) => `${p.schema}.${p.table}`).sort()).toEqual(
      [...IMPORT_TARGET_RELATIONS].sort(),
    );
  });

  it("every required policy is PERMISSIVE, owner-only, with exact one-sided constant-true expressions", () => {
    for (const p of REQUIRED_RLS_POLICIES) {
      expect(p.schema).toBe("public");
      expect(p.permissive).toBe(true);
      expect([...p.roles]).toEqual([EXECUTION_OWNER_ROLE]);
      if (p.command === "SELECT") {
        expect(p.polcmd).toBe("r");
        expect(p.using).toBe("true");
        expect(p.withCheck).toBeNull();
      } else {
        expect(p.command).toBe("INSERT");
        expect(p.polcmd).toBe("a");
        expect(p.using).toBeNull();
        expect(p.withCheck).toBe("true");
      }
    }
  });

  it("declares no ALL, UPDATE, or DELETE policy and no broad role anywhere in the inventory", () => {
    for (const p of REQUIRED_RLS_POLICIES) {
      expect(["SELECT", "INSERT"]).toContain(p.command);
      for (const role of p.roles) {
        expect(role).toBe(EXECUTION_OWNER_ROLE);
        expect([
          "PUBLIC",
          "public",
          "anon",
          "authenticated",
          "service_role",
          "postgres",
        ]).not.toContain(role);
      }
    }
  });
});

describe("RC5.5D RLS expression normalization (review 11)", () => {
  it("accepts exactly the constant-true renderings", () => {
    expect([...CONSTANT_TRUE_NORMALIZED_FORMS]).toEqual(["true", "(true)"]);
    for (const expr of ["true", "(true)", " ( true ) ", "  true\n"]) {
      expect(isConstantTruePolicyExpression(expr), expr).toBe(true);
    }
  });

  it.each([
    ["null / absent", null],
    ["undefined", undefined],
    ["false", "false"],
    ["(false)", "(false)"],
    ["uppercase TRUE (never rendered by pg_get_expr)", "TRUE"],
    ["double-wrapped ((true))", "((true))"],
    ["a disjunct smuggled in", "(true OR is_admin())"],
    ["a conjunction", "(true AND true)"],
    ["a column predicate", "(is_active = true)"],
    ["a helper-function call", "public.policy_helper()"],
    ["a session setting", "(current_setting('app.bypass'::text) = 'true'::text)"],
    ["a JWT claim", "((auth.jwt() ->> 'role'::text) = 'true'::text)"],
    ["a current_user condition", "(CURRENT_USER = 'forever_import_execution_owner'::name)"],
    ["a subquery", "(SELECT true)"],
    ["a string literal containing true", "'true'"],
    ["a word merely containing true", "truely"],
  ])("rejects %s", (_label, expr) => {
    expect(isConstantTruePolicyExpression(expr as string | null | undefined)).toBe(false);
  });

  it("normalizes whitespace and public-qualification only — semantics never collapse", () => {
    expect(normalizePolicyExpression("( true )")).toBe("(true)");
    expect(
      normalizePolicyExpression(
        "EXISTS (SELECT 1 FROM public.projects p WHERE p.id = units.project_id AND p.is_active = true)",
      ),
    ).toBe(
      normalizePolicyExpression(
        "EXISTS (SELECT 1 FROM projects p WHERE p.id = units.project_id AND p.is_active = true)",
      ),
    );
    // A different semantic expression never normalizes onto the expected form.
    expect(normalizePolicyExpression("(is_active = true)")).not.toBe(
      normalizePolicyExpression("(true)"),
    );
    expect(normalizePolicyExpression("(is_active = false)")).not.toBe(
      normalizePolicyExpression("(is_active = true)"),
    );
  });
});

describe("RC5.5D RLS approved pre-existing read policies (review 11)", () => {
  it("enumerates exactly the six committed website SELECT policies with their sources", () => {
    expect(APPROVED_PREEXISTING_READ_POLICIES).toHaveLength(6);
    expect(APPROVED_PREEXISTING_READ_POLICIES.map((p) => `${p.schema}.${p.table}`).sort()).toEqual(
      [...ALL_TARGET_RELATIONS].sort(),
    );
    expect(APPROVED_PREEXISTING_READ_POLICIES.map((p) => p.name).sort()).toEqual(
      [
        "Developers are viewable by everyone",
        "Locations are viewable by everyone",
        "Active projects are viewable by everyone",
        "Units of active projects are viewable by everyone",
        "Buildings of active projects are viewable",
        "Price history of active project units is viewable",
      ].sort(),
    );
    for (const p of APPROVED_PREEXISTING_READ_POLICIES) {
      expect(p.command).toBe("SELECT");
      expect(p.polcmd).toBe("r");
      expect(p.permissive).toBe(true);
      expect(p.roles).toBe("PUBLIC");
      expect(p.withCheck).toBeNull();
      expect(p.sourceMigration).toMatch(/^\d{14}_.+\.sql$/);
      expect(p.usingNormalizedAccepted.length).toBeGreaterThanOrEqual(1);
      for (const accepted of p.usingNormalizedAccepted) {
        // Committed in normalized form: no whitespace, no public. qualification.
        expect(accepted).not.toMatch(/\s/);
        expect(accepted).not.toContain("public.");
        expect(normalizePolicyExpression(accepted)).toBe(accepted);
      }
    }
  });

  it("none of the approved pre-existing policies is a write policy or restrictive", () => {
    for (const p of APPROVED_PREEXISTING_READ_POLICIES) {
      expect(p.command).toBe("SELECT");
      expect(p.permissive).toBe(true);
    }
  });
});

describe("RC5.5D RLS applicable-policy classification (review 11)", () => {
  /** The exact observed form of one required policy, as the migration creates it. */
  function observedRequired(name: string): ObservedTargetTablePolicy {
    const p = REQUIRED_RLS_POLICIES.find((r) => r.name === name)!;
    return {
      schema: p.schema,
      table: p.table,
      name: p.name,
      command: p.command,
      permissive: true,
      roles: [EXECUTION_OWNER_ROLE],
      using: p.command === "SELECT" ? "true" : null,
      withCheck: p.command === "INSERT" ? "true" : null,
    };
  }

  /** The exact observed form of one approved pre-existing policy (deparsed rendering). */
  function observedApproved(name: string): ObservedTargetTablePolicy {
    const p = APPROVED_PREEXISTING_READ_POLICIES.find((a) => a.name === name)!;
    return {
      schema: p.schema,
      table: p.table,
      name: p.name,
      command: "SELECT",
      permissive: true,
      roles: ["PUBLIC"],
      using: p.usingNormalizedAccepted[0],
      withCheck: null,
    };
  }

  it("classifies all ten exact required policies as required_execution_policy", () => {
    for (const p of REQUIRED_RLS_POLICIES) {
      expect(classifyTargetTablePolicy(observedRequired(p.name)), p.name).toBe(
        "required_execution_policy",
      );
    }
  });

  it("classifies all six approved pre-existing policies (exact definitions) as approved", () => {
    for (const p of APPROVED_PREEXISTING_READ_POLICIES) {
      expect(classifyTargetTablePolicy(observedApproved(p.name)), p.name).toBe(
        "approved_preexisting_read_policy",
      );
    }
    // The source-form rendering variant is also accepted.
    const units = observedApproved("Units of active projects are viewable by everyone");
    expect(
      classifyTargetTablePolicy({
        ...units,
        using:
          "EXISTS (SELECT 1 FROM public.projects p WHERE p.id = units.project_id AND p.is_active = true)",
      }),
    ).toBe("approved_preexisting_read_policy");
  });

  it.each<[string, ObservedTargetTablePolicy]>([
    [
      "a wrong policy name",
      { ...observedRequired("forever_import_owner_select_units"), name: "owner_select_units" },
    ],
    [
      "a required name on the wrong table",
      { ...observedRequired("forever_import_owner_select_units"), table: "projects" },
    ],
    [
      "a wrong command (INSERT under a SELECT name)",
      {
        ...observedRequired("forever_import_owner_select_units"),
        command: "INSERT",
        using: null,
        withCheck: "true",
      },
    ],
    [
      "ALL instead of SELECT",
      { ...observedRequired("forever_import_owner_select_units"), command: "ALL" },
    ],
    [
      "RESTRICTIVE instead of PERMISSIVE",
      { ...observedRequired("forever_import_owner_select_units"), permissive: false },
    ],
    [
      "owner plus authenticated",
      {
        ...observedRequired("forever_import_owner_insert_units"),
        roles: [EXECUTION_OWNER_ROLE, "authenticated"],
      },
    ],
    [
      "owner plus another custom role",
      {
        ...observedRequired("forever_import_owner_insert_units"),
        roles: [EXECUTION_OWNER_ROLE, "some_custom_role"],
      },
    ],
    [
      "PUBLIC instead of the owner",
      { ...observedRequired("forever_import_owner_insert_units"), roles: ["PUBLIC"] },
    ],
    ["an empty role set", { ...observedRequired("forever_import_owner_insert_units"), roles: [] }],
    [
      "SELECT USING (false)",
      { ...observedRequired("forever_import_owner_select_units"), using: "false" },
    ],
    [
      "SELECT with a helper-function predicate",
      {
        ...observedRequired("forever_import_owner_select_units"),
        using: "public.policy_helper()",
      },
    ],
    [
      "SELECT with an unexpected WITH CHECK",
      { ...observedRequired("forever_import_owner_select_units"), withCheck: "true" },
    ],
    [
      "INSERT WITH CHECK (false)",
      { ...observedRequired("forever_import_owner_insert_units"), withCheck: "(false)" },
    ],
    [
      "INSERT with a helper-function predicate",
      {
        ...observedRequired("forever_import_owner_insert_units"),
        withCheck: "forever_import.validate_row(units.*)",
      },
    ],
    [
      "INSERT with an unexpected USING",
      { ...observedRequired("forever_import_owner_insert_units"), using: "true" },
    ],
  ])("classifies %s as unexpected_policy (required-name drift fails closed)", (_label, policy) => {
    expect(classifyTargetTablePolicy(policy)).toBe("unexpected_policy");
  });

  it.each<[string, ObservedTargetTablePolicy]>([
    [
      "an approved name with a drifted expression",
      {
        ...observedApproved("Active projects are viewable by everyone"),
        using: "(is_active = false)",
      },
    ],
    [
      "an approved name turned RESTRICTIVE",
      { ...observedApproved("Locations are viewable by everyone"), permissive: false },
    ],
    [
      "an approved name broadened beyond PUBLIC",
      {
        ...observedApproved("Developers are viewable by everyone"),
        roles: ["PUBLIC", "service_role"],
      },
    ],
    [
      "an approved name changed to a write command",
      {
        ...observedApproved("Developers are viewable by everyone"),
        command: "INSERT",
        using: null,
        withCheck: "true",
      },
    ],
    [
      "an approved name with an unexpected WITH CHECK",
      { ...observedApproved("Developers are viewable by everyone"), withCheck: "true" },
    ],
    [
      "a brand-new harmless-looking SELECT policy (must be classified first)",
      {
        schema: "public",
        table: "units",
        name: "New units read policy",
        command: "SELECT",
        permissive: true,
        roles: ["PUBLIC"],
        using: "true",
        withCheck: null,
      },
    ],
    [
      "a membership-derived policy for another role",
      {
        schema: "public",
        table: "units",
        name: "group write",
        command: "INSERT",
        permissive: true,
        roles: ["some_group"],
        using: null,
        withCheck: "true",
      },
    ],
  ])("classifies %s as unexpected_policy", (_label, policy) => {
    expect(classifyTargetTablePolicy(policy)).toBe("unexpected_policy");
  });

  it("applicability handles direct role, PUBLIC, and transitive membership — and nothing else", () => {
    expect(policyAppliesToExecutionOwner({ roles: [EXECUTION_OWNER_ROLE] })).toBe(true);
    expect(policyAppliesToExecutionOwner({ roles: ["PUBLIC"] })).toBe(true);
    expect(policyAppliesToExecutionOwner({ roles: ["some_group"] }, ["some_group"])).toBe(true);
    expect(policyAppliesToExecutionOwner({ roles: ["some_group"] })).toBe(false);
    expect(policyAppliesToExecutionOwner({ roles: ["anon", "authenticated"] })).toBe(false);
    expect(policyAppliesToExecutionOwner({ roles: [] })).toBe(false);
  });
});

describe("RC5.5D RLS exact-policy SQL shape (review 11)", () => {
  const sqlOf = (name: string): string => {
    const check = EFFECTIVE_PRIVILEGE_AUDIT.find((c) => c.name === name);
    expect(check, name).toBeDefined();
    return check!.sql;
  };

  it("the role-set proof is oid-ARRAY EQUALITY, never 'owner appears somewhere in polroles'", () => {
    const sql = sqlOf("rls_required_policy_roles_exact");
    expect(sql).toContain("pol.polroles = ARRAY[ow.oid]::pg_catalog.oid[]");
    expect(sql).not.toContain("ro.oid = ANY (pol.polroles)");
    expect(sql).not.toContain("JOIN pg_catalog.pg_roles ro");
  });

  it("no review-11 policy check resolves polroles through a pg_roles join (PUBLIC OID 0 is invisible there)", () => {
    for (const name of [
      "rls_required_policy_inventory_exact",
      "rls_policy_target_relations_exact",
      "rls_required_policies_are_permissive",
      "rls_required_policy_roles_exact",
      "rls_required_select_expressions_exact",
      "rls_required_insert_expressions_exact",
      "rls_no_unclassified_applicable_policy",
      "rls_no_applicable_update_delete_or_all_policy",
      "rls_no_applicable_restrictive_policy",
      "rls_no_public_write_policy",
    ]) {
      expect(sqlOf(name), name).not.toContain("JOIN pg_catalog.pg_roles ro");
    }
  });

  it("applicability covers direct owner OID, PUBLIC grantee OID 0, and the recursive membership closure", () => {
    for (const name of [
      "rls_no_unclassified_applicable_policy",
      "rls_no_applicable_update_delete_or_all_policy",
      "rls_no_applicable_restrictive_policy",
    ]) {
      const sql = sqlOf(name);
      expect(sql, name).toContain("ow.oid = ANY (pol.polroles)");
      expect(sql, name).toContain("0::pg_catalog.oid = ANY (pol.polroles)");
      expect(sql, name).toContain("WITH RECURSIVE owner_groups");
      expect(sql, name).toContain("pg_auth_members");
    }
  });

  it("the PUBLIC write-policy check matches the PUBLIC grantee OID directly", () => {
    const sql = sqlOf("rls_no_public_write_policy");
    expect(sql).toContain("pol.polcmd IN ('a','w','d','*')");
    expect(sql).toContain("0::pg_catalog.oid = ANY (pol.polroles)");
  });

  it("expression proofs read pg_get_expr on the exact side and pin the tight normalized constant-true forms", () => {
    const sel = sqlOf("rls_required_select_expressions_exact");
    expect(sel).toContain("pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)");
    expect(sel).toContain("pol.polqual IS NOT NULL");
    expect(sel).toContain("pol.polwithcheck IS NULL");
    expect(sel).toContain("IN ('true', '(true)')");
    expect(sel).toContain("regexp_replace");
    const ins = sqlOf("rls_required_insert_expressions_exact");
    expect(ins).toContain("pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)");
    expect(ins).toContain("pol.polqual IS NULL");
    expect(ins).toContain("pol.polwithcheck IS NOT NULL");
    expect(ins).toContain("IN ('true', '(true)')");
  });

  it("permissive proof requires pg_policy.polpermissive on every required policy", () => {
    expect(sqlOf("rls_required_policies_are_permissive")).toContain("pol.polpermissive");
    expect(sqlOf("rls_no_applicable_restrictive_policy")).toContain("NOT pol.polpermissive");
  });

  it("the inventory checks embed every one of the ten exact policy names", () => {
    for (const name of [
      "rls_required_policy_inventory_exact",
      "rls_policy_target_relations_exact",
    ]) {
      const sql = sqlOf(name);
      for (const p of REQUIRED_RLS_POLICIES) {
        expect(sql, `${name} embeds ${p.name}`).toContain(`'${p.name}'`);
      }
    }
  });

  it("the classification check embeds the complete approved pre-existing definitions", () => {
    const sql = sqlOf("rls_no_unclassified_applicable_policy");
    for (const p of APPROVED_PREEXISTING_READ_POLICIES) {
      expect(sql).toContain(`'${p.name}'`);
      expect(sql).toContain(`'${p.usingNormalizedAccepted[0]}'`);
    }
    // Approved policies must be EXACTLY PUBLIC-scoped, permissive, read-only.
    expect(sql).toContain("pol.polroles = ARRAY[0]::pg_catalog.oid[]");
    expect(sql).toContain("pol.polpermissive");
    // Required policies must match their full definition, not merely their name.
    expect(sql).toContain("pol.polroles = ARRAY[ow.oid]::pg_catalog.oid[]");
  });

  it("the write-policy and restrictive scans cover all six target tables", () => {
    for (const name of [
      "rls_no_applicable_update_delete_or_all_policy",
      "rls_no_applicable_restrictive_policy",
      "rls_no_public_write_policy",
      "rls_no_unclassified_applicable_policy",
    ]) {
      const sql = sqlOf(name);
      for (const rel of ALL_TARGET_RELATIONS) {
        const [sch, tbl] = rel.split(".");
        expect(sql, `${name} covers ${rel}`).toContain(`('${sch}','${tbl}')`);
      }
    }
  });
});
