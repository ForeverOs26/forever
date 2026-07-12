import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as barrel from "..";

/** The RC4.6 module root, resolved from the repository root vitest runs in. */
const MODULE_ROOT = join(process.cwd(), "src", "features", "forever-project-database");

/** Every .ts file under a directory, recursively. */
function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

const TESTS_ROOT = join(MODULE_ROOT, "tests");
const ALL_FILES = listSourceFiles(MODULE_ROOT);
const SOURCE_FILES = ALL_FILES.filter((path) => !path.startsWith(TESTS_ROOT));
const TEST_FILES = ALL_FILES.filter((path) => path.startsWith(TESTS_ROOT));

/** Imports the architecture-only module is allowed to reach. */
const ALLOWED_IMPORTS = [
  "@/features/forever-database",
  "@/features/forever-sync",
  "@/features/forever-project-integration",
  "@/features/forever-project-sources",
  "@/features/forever-extraction-pipeline",
];

describe("public barrel exports", () => {
  it("exports every required architectural concept", () => {
    const names = Object.keys(barrel);
    for (const name of [
      // identity and naming
      "deriveProjectRecordIdentity",
      "PROJECT_DATABASE_ID_PREFIXES",
      "projectRecordIdFor",
      "projectFieldIdFor",
      "projectRevisionIdFor",
      "projectSnapshotIdFor",
      "projectMergeIdFor",
      "normalizeProjectDatabaseSlug",
      "projectDatabaseProjectId",
      // sections
      "PROJECT_SECTION_KEYS",
      "projectSectionFor",
      "listProjectSections",
      "projectSectionForPath",
      "compareProjectSections",
      // value, field, record, database
      "projectFieldValue",
      "projectFieldValueFromFact",
      "projectFieldValueSignature",
      "describeProjectField",
      "currentProjectFieldValue",
      "supersededProjectFieldValues",
      "removedProjectFieldValues",
      "appendProjectFieldValue",
      "describeProjectRecord",
      "emptyProjectDatabase",
      "addProjectRecord",
      "findProjectRecord",
      // revision, change, snapshot, timeline, history
      "describeProjectRevision",
      "projectChange",
      "PROJECT_CHANGE_KINDS",
      "describeProjectSnapshot",
      "addProjectSnapshot",
      "latestProjectSnapshot",
      "emptyProjectTimeline",
      "appendProjectTimelineEvent",
      "projectTimelineEvent",
      "emptyProjectHistory",
      "appendProjectHistory",
      "latestProjectHistoryEntry",
      // merge
      "describeProjectMerge",
      "PROJECT_MERGE_ENTRY_KINDS",
      "listProjectMergeEntries",
      "projectMergeHistoryEntry",
      "createProjectResult",
      // policy, catalog, registry, provider
      "defaultProjectDatabasePolicy",
      "emptyProjectDatabaseCatalog",
      "addProjectDatabaseCatalogEntry",
      "ProjectRegistry",
      "defineProjectProvider",
      // validation
      "validateProjectRecordIdentity",
      "validateProjectFieldValue",
      "validateProjectField",
      "validateProjectRevision",
      "validateProjectRevisions",
      "validateProjectSnapshot",
      "validateProjectSnapshots",
      "validateProjectTimeline",
      "validateProjectHistory",
      "validateProjectRecord",
      "validateProjectMerge",
      "validateProjectDatabase",
      "validateProjectDatabaseCatalog",
      "validateProjectRegistry",
      "validateProjectRecordVersion",
      "validateProjectDatabasePolicy",
      // reuse hub
      "projectDatabaseError",
      "projectDatabaseWarning",
      "partitionProjectDatabaseIssues",
      "projectRecordVersion",
      "projectConfidence",
      "unknownProjectConfidence",
    ]) {
      expect(names, `barrel is missing ${name}`).toContain(name);
    }
  });
});

describe("forbidden runtime dependencies", () => {
  it("scans clean: no clock, randomness, IO, network, persistence, or UI in the module", () => {
    // Word-shaped patterns that would betray a runtime dependency. Comments in
    // the module are written to avoid false positives, so any hit is real.
    const forbidden = [
      /\bDate\.now\(/,
      /\bnew Date\(/,
      /\bMath\.random\(/,
      /\bfetch\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /supabase-js/,
      /createClient\(/,
      /process\.env/,
      /localStorage/,
      /sessionStorage/,
      /\bsetTimeout\(/,
      /\bsetInterval\(/,
      /\.localeCompare\(/,
      /toLocale/,
      /\bIntl\./,
      /from "react"/,
      /from "node:/,
      /from "fs"/,
      /require\(/,
      /@tanstack/,
      /@supabase/,
      /@\/integrations/,
    ];
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
    for (const path of SOURCE_FILES) {
      const content = readFileSync(path, "utf8");
      for (const pattern of forbidden) {
        expect(pattern.test(content), `${path} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("imports only the reused Forever foundations and its own files", () => {
    const importPattern = /from "([^"]+)"/g;
    for (const path of SOURCE_FILES) {
      const content = readFileSync(path, "utf8");
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1];
        const allowed = specifier.startsWith(".") || ALLOWED_IMPORTS.includes(specifier);
        expect(allowed, `${path} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("keeps the test suite honest: no focused, skipped, or stubbed tests", () => {
    expect(TEST_FILES.length).toBeGreaterThan(0);
    const focused = /\b(?:describe|it|test)\.(?:only|skip|todo|skipIf|failing|runIf)\s*\(/;
    const aliased = /\bx(?:describe|it|test)\s*\(/;
    for (const path of TEST_FILES) {
      const content = readFileSync(path, "utf8");
      expect(focused.test(content), `${path} focuses, skips, or stubs a test`).toBe(false);
      expect(aliased.test(content), `${path} disables a test via an x-alias`).toBe(false);
    }
  });
});
