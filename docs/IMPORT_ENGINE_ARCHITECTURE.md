# Forever Import Engine Architecture

Task ID: RC3-001 / RC3-002 / RC3-003

Status: Project + Buildings dry-run import stage added after initial production-ready architecture skeleton

## Purpose

The Forever Import Engine imports one validated project package from `forever-data/projects/{project_slug}/` into the Forever database. It is reusable for every Forever project and must keep missing facts missing, reject incomplete packages, support dry-run planning, and prepare database writes without importing unless explicitly executed.

## Folder Structure

```text
src/import/
  cli.ts                 CLI entrypoint
  manifest.ts            Manifest loading and shape validation
  validator.ts           Package/readiness/source validation
  datasets.ts            Extracted dataset loading
  planner.ts             Deterministic import-plan creation
  plan-validator.ts      Relationship and duplicate validation
  state-machine.ts       Import lifecycle transitions
  rollback.ts            Rollback contract and skeleton
  database.ts            Supabase insertion/upsert layer
  importer.ts            Pipeline orchestrator
  types.ts               Shared interfaces and error/state model
```

Project packages use:

```text
forever-data/projects/{project_slug}/
  manifest.json
  import-status.json
  extracted/
  source/
```

## Import Pipeline

1. Initialize execution context.
2. Read `manifest.json`.
3. Load supported extracted datasets.
4. Validate manifest and package readiness.
5. If `ready_for_import=false`, enter `blocked`, return a validation summary, and stop before creating an import plan or database client.
6. Create an import plan for the current enabled stage.
7. Validate plan relationships.
8. In dry-run mode, return counts and operations without creating a Supabase client.
9. In execute mode, run only database write paths explicitly enabled for the current stage.
10. If execution fails, enter rollback state and use the rollback contract.
11. Return an import summary.

## Current Enabled Stage

RC3-003 enables the canonical Project stage plus a Buildings-only stage.

The Project stage creates an internal `CanonicalProject` object from the manifest, readiness validation, and extracted dataset context. It populates canonical Project fields only. Missing optional facts remain `null`, `SOURCE_PENDING` is never replaced, and validation still blocks packages that are not ready.

The Buildings stage derives canonical building objects only from source-backed extracted price-list building facts. It adds building operations after the Project operation in the import plan. Building codes are source-backed from extracted rows, while units count, floors count, and source metadata are deterministic aggregates from those source-backed rows.

The current Project + Buildings stage intentionally does not import:

- Units.
- Media.
- Documents.
- Relationships.
- Intelligence.
- Passport data.
- Prices.

Dry-run returns Project + Buildings operation counts only. Execute mode is blocked until a Project + Buildings database write path is explicitly approved.

## Validation Pipeline

Validation is layered:

- Manifest shape: required metadata, manifest format, supported version.
- Package readiness: `import-status.json`, required folders, required files, extracted JSON.
- Metadata safety: blocks `SOURCE_PENDING` and empty required manifest fields.
- Dataset loading: parse JSON or fail loudly on invalid JSON.
- Relationship validation: duplicate units, duplicate price-history source keys, orphan unit/building links, orphan price-history/unit links.

Validation issues use a shared model:

```ts
{
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
}
```

## Import Plan

The import plan is the durable boundary between validation and database execution. It contains:

- Manifest and validation report.
- Loaded datasets.
- Canonical Project object.
- Canonical Building objects.
- Normalized project facts.
- Project-stage and Building-stage payloads for the enabled import stage.
- Ordered operations with natural keys and dependencies.
- Rollback plan.

## Database Insertion Layer

`database.ts` remains the only module allowed to create a Supabase import client or perform writes. Dry-run mode never creates the client. RC3-003 blocks execute mode while the current enabled stage is Project + Buildings and has no approved database write path.

Future versions should add transaction-scoped execution and canonical source/media/document/intelligence insertion without changing the import-plan boundary.

## Rollback Strategy

Dry-run requires no rollback.

Execute mode creates a compensating rollback plan in reverse dependency order. The current skeleton records rollback intent and keeps writes idempotent; it does not auto-delete or mutate rows until transaction support and audit snapshots are added.

Preferred v2 rollback:

- Wrap each import in a database transaction or RPC.
- Capture prior row snapshots for every upsert.
- On failure, restore previous rows and delete newly inserted rows.
- Write an immutable audit record for completed or rolled-back imports.

## Import State Machine

```text
initialized
  -> manifest_loaded
  -> datasets_loaded
  -> package_validated
  -> plan_created
  -> relationships_validated
  -> dry_run_completed -> completed
  -> blocked -> completed
  -> executing -> completed
  -> executing -> rolling_back -> rolled_back -> failed
```

Any state may fail only through explicit allowed transitions in `state-machine.ts`.
