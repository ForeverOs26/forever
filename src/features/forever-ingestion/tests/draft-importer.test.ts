import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("generic draft project importer", () => {
  const importer = read("scripts/import/Import-ForeverProjectDraft.ps1");
  const launcher = read("scripts/import/Start-ForeverProjectDraftImport.ps1");
  const command = read("Import Forever Project Draft.cmd");

  it("keeps the normal path small, generic, and atomic", () => {
    expect(importer).toContain("forever-data\\projects");
    expect(importer).toContain("public.forever_progressive_ingest(payload)");
    expect(importer).toContain("BEGIN;");
    expect(importer).toContain("COMMIT;");
    expect(importer).toContain("draft_import_duplicate_slug");
    expect(importer).toContain("draft_import_duplicate_batch_fingerprint");
    expect(importer).toContain("DRAFT_IMPORT_POST_COMMIT");
    expect(importer).toContain("PGSSLMODE");
    expect(importer).toContain("verify-full");
    expect(importer).not.toContain("pg_stat_ssl");
    expect(importer).not.toContain("coralina");
    expect(importer).not.toContain("migration list");
  });

  it("keeps the payload and password out of command-line arguments", () => {
    expect(importer).toContain("RedirectStandardInput = $true");
    expect(importer).toContain("$process.StandardInput.Write($Sql)");
    expect(importer).not.toContain("-f', $PayloadPath");
    expect(launcher).toContain("Read-Host 'Database password' -AsSecureString");
    expect(command).toContain("start \"Forever Draft Project Import\" powershell.exe");
  });
});
