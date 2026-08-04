/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the Studio write contract, checked
 * against real source with a real parser (independent-review P1-3).
 *
 * WHY AN AST AND NOT A GREP. The review's finding was not "these five calls are
 * unregistered"; it was that registration was a thing each call site had to
 * remember, so the NEXT mutation would be unregistered too. A hand-maintained
 * list cannot detect a new call. This can:
 *
 *   - it enumerates every `createServerFn({ method: "POST" })` export from
 *     `studio.functions.ts` and fails if one is missing from the contract
 *     table, or if the table names one that no longer exists;
 *   - it walks every Studio source file with the TypeScript compiler and fails
 *     if any call to one of those functions is not lexically enclosed by
 *     `runStudioWriteAction`;
 *   - it fails if the read-only split drifts.
 *
 * A failure here is deliberate and is fixed by routing the new mutation through
 * the boundary and adding its contract row — never by editing this file to look
 * away.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  STUDIO_NON_SERVER_FUNCTION_WRITES,
  STUDIO_READ_ONLY_FUNCTIONS,
  STUDIO_WRITE_BOUNDARY_EXEMPTIONS,
  STUDIO_WRITE_CONTRACT,
} from "./studio-write-contract";
import { STALE_ASSET_CONSEQUENTIAL_ACTIONS } from "./write-safety";

const REPO = process.cwd();
const FUNCTIONS_FILE = "src/features/forever-studio/studio.functions.ts";
const BOUNDARY = "runStudioWriteAction";

function read(path: string): string {
  return readFileSync(resolve(REPO, path), "utf8");
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Every exported server function, with the HTTP method it declares.
 *
 * Read from the AST rather than a regex so a reformat, a comment or a differing
 * argument order cannot hide one.
 */
function declaredServerFunctions(): Array<{ name: string; method: string }> {
  const source = parse(FUNCTIONS_FILE);
  const found: Array<{ name: string; method: string }> = [];

  const methodOf = (node: ts.Node): string | null => {
    let method: string | null = null;
    const visit = (child: ts.Node): void => {
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === "createServerFn"
      ) {
        const [options] = child.arguments;
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "method" &&
              ts.isStringLiteral(property.initializer)
            ) {
              method = property.initializer.text;
            }
          }
        }
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return method;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const method = methodOf(declaration.initializer);
          if (method) found.push({ name: declaration.name.text, method });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every .ts/.tsx file under src/, excluding tests and the declarations file. */
function studioSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry)) continue;
      const relativePath = relative(REPO, full).split("\\").join("/");
      if (relativePath === FUNCTIONS_FILE) continue;
      if (relativePath.includes("/tests/")) continue;
      out.push(relativePath);
    }
  };
  walk(resolve(REPO, "src"));
  return out;
}

type CallSite = { file: string; mutation: string; line: number; wrapped: boolean };

/**
 * Finds every CALL of a named mutation and reports whether it sits inside a
 * `runStudioWriteAction(...)` call.
 *
 * "Inside" means lexically enclosed by the boundary call expression, which is
 * exactly the property that guarantees registration happened synchronously
 * before dispatch could begin.
 */
function callSitesOf(mutations: Set<string>): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of studioSourceFiles()) {
    const text = read(file);
    // Cheap pre-filter so the parser only runs where it can find something.
    if (![...mutations].some((name) => text.includes(name))) continue;
    const source = parse(file);

    const visit = (node: ts.Node, insideBoundary: boolean): void => {
      let nowInside = insideBoundary;
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === BOUNDARY
      ) {
        nowInside = true;
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        mutations.has(node.expression.text)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        sites.push({
          file,
          mutation: node.expression.text,
          line: line + 1,
          wrapped: insideBoundary,
        });
      }
      ts.forEachChild(node, (child) => visit(child, nowInside));
    };
    visit(source, false);
  }
  return sites;
}

const declared = declaredServerFunctions();
const declaredWrites = declared.filter((entry) => entry.method === "POST").map((e) => e.name);
const declaredReads = declared.filter((entry) => entry.method !== "POST").map((e) => e.name);
const contractedWrites = STUDIO_WRITE_CONTRACT.map((entry) => entry.mutation);

describe("the Studio write inventory is complete and derived from source", () => {
  it("finds the server functions at all (a parser that finds nothing proves nothing)", () => {
    expect(declared.length).toBeGreaterThanOrEqual(19);
    expect(declaredWrites.length).toBeGreaterThanOrEqual(13);
  });

  it("every POST server function has a contract row", () => {
    const missing = declaredWrites.filter((name) => !contractedWrites.includes(name));
    expect(missing, `mutations missing from STUDIO_WRITE_CONTRACT: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("every contract row names a server function that still exists", () => {
    const stale = contractedWrites.filter((name) => !declaredWrites.includes(name));
    expect(stale, `contract rows with no server function: ${stale.join(", ")}`).toEqual([]);
  });

  it("the read-only split is explicit and exact", () => {
    expect([...declaredReads].sort()).toEqual([...STUDIO_READ_ONLY_FUNCTIONS].sort());
  });

  it("every contract row names a declared consequential-action kind", () => {
    for (const entry of [...STUDIO_WRITE_CONTRACT, ...STUDIO_NON_SERVER_FUNCTION_WRITES]) {
      expect(STALE_ASSET_CONSEQUENTIAL_ACTIONS, entry.mutation).toContain(entry.action);
    }
  });

  it("every declared action kind is actually used — no dead vocabulary", () => {
    // Independent-review P3-5: `upload_confirm` was declared and never
    // registered. Dead vocabulary is a symptom of an incomplete inventory.
    const used = new Set(
      [...STUDIO_WRITE_CONTRACT, ...STUDIO_NON_SERVER_FUNCTION_WRITES].map((e) => e.action),
    );
    const unused = STALE_ASSET_CONSEQUENTIAL_ACTIONS.filter((action) => !used.has(action));
    expect(unused, `declared but never registered: ${unused.join(", ")}`).toEqual([]);
  });

  it("every contract row states its lost-response and recovered-page behaviour", () => {
    for (const entry of [...STUDIO_WRITE_CONTRACT, ...STUDIO_NON_SERVER_FUNCTION_WRITES]) {
      expect(entry.registration.length, entry.mutation).toBeGreaterThan(10);
      expect(entry.dispatch.length, entry.mutation).toBeGreaterThan(5);
      expect(entry.release.length, entry.mutation).toBeGreaterThan(10);
      expect(entry.lostResponse.length, entry.mutation).toBeGreaterThan(10);
      expect(entry.recoveredPage.length, entry.mutation).toBeGreaterThan(10);
    }
  });
});

describe("every Studio mutation call site is inside the canonical write boundary", () => {
  const sites = callSitesOf(new Set(declaredWrites));

  it("finds call sites at all (a scan that finds nothing proves nothing)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(13);
  });

  it("every exemption is real, justified, and its stated registration exists", () => {
    for (const entry of STUDIO_WRITE_BOUNDARY_EXEMPTIONS) {
      // A stale exemption is a hole: it must correspond to a call site that
      // actually exists and is actually unwrapped.
      const matching = sites.filter(
        (site) => site.file === entry.file && site.mutation === entry.mutation,
      );
      expect(matching.length, `stale exemption: ${entry.file} ${entry.mutation}`).toBeGreaterThan(
        0,
      );
      expect(
        matching.some((site) => !site.wrapped),
        entry.mutation,
      ).toBe(true);
      expect(entry.why.length, entry.mutation).toBeGreaterThan(40);
      expect(read(entry.file), entry.mutation).toContain(entry.registrationMustContain);
    }
  });

  it("no mutation is dispatched outside runStudioWriteAction", () => {
    const exempt = (site: CallSite) =>
      STUDIO_WRITE_BOUNDARY_EXEMPTIONS.some(
        (entry) => entry.file === site.file && entry.mutation === site.mutation,
      );
    const bypassing = sites
      .filter((site) => !site.wrapped && !exempt(site))
      .map((site) => `${site.file}:${site.line} ${site.mutation}`);
    expect(
      bypassing,
      `Studio mutations dispatched outside ${BOUNDARY}:\n${bypassing.join("\n")}`,
    ).toEqual([]);
  });

  it("covers every declared write — no mutation is unreachable from the UI without a note", () => {
    const called = new Set(sites.map((site) => site.mutation));
    const uncalled = declaredWrites.filter((name) => !called.has(name));
    expect(uncalled, `declared writes with no call site: ${uncalled.join(", ")}`).toEqual([]);
  });
});

describe("the non-server-function writes are registered too", () => {
  it("the password update registers before the request leaves", () => {
    const source = read("src/features/forever-studio/components/StudioResetPassword.tsx");
    const registration = source.indexOf('beginConsequentialAction("password_update")');
    const dispatch = source.indexOf("auth.updateUser(");
    expect(registration).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    expect(registration).toBeLessThan(dispatch);
  });

  it("Owner Retry registers synchronously with its absolute deadline", () => {
    const source = read("src/features/forever-studio/components/StudioDashboard.tsx");
    const registration = source.indexOf('beginConsequentialAction("owner_retry_submit")');
    const dispatch = source.indexOf("retryJob.mutateAsync(");
    expect(registration).toBeGreaterThan(-1);
    expect(registration).toBeLessThan(dispatch);
    // A lost submit response leaves the action unreconciled, not safe.
    expect(source).toContain('markConsequentialActionUnreconciled("owner_retry_submit")');
    // And only the READ-ONLY refresh path reconciles it.
    expect(source).toContain('reconcileConsequentialAction("owner_retry_submit")');
  });
});

describe("studioResumePending cannot auto-fire from a recovered page", () => {
  const source = read("src/features/forever-studio/components/StudioDashboard.tsx");

  it("is gated on the recovery machine being idle", () => {
    expect(source).toContain('recoveryState === "idle"');
  });

  it("is gated on no unproven write", () => {
    expect(source).toContain("!hasUnprovenConsequentialAction()");
  });

  it("is gated on a resolved READ-ONLY overview", () => {
    expect(source).toContain("overview.isSuccess");
    expect(source).toContain("if (!resumeIsSafe) return;");
  });

  it("dispatches through the canonical boundary", () => {
    expect(source).toContain('runStudioWriteAction("resume_pending", () => studioResumePending(');
  });
});
