# RC3 Release Review: Forever Import Engine

Task ID: RC3-RELEASE

Date: 2026-07-09

Status: Official RC3 release review

## Scope

This review evaluates the current Forever Import Engine as an engineering release candidate. It is documentation-only and does not modify application code, project data, database schema, database data, UI, or Import Engine behavior.

Reviewed sources:

- `docs/FOREVER_DOC_INDEX.md`
- `docs/CODEX_OPERATING_MANUAL.md`
- `docs/IMPORT_ENGINE_ARCHITECTURE.md`
- `docs/FOREVER_STATUS.md`
- `docs/KNOWLEDGE_MODEL.md`
- `docs/FOREVER_DEVELOPMENT_ROADMAP.md`
- `docs/ROADMAP.md`
- `docs/DATA_STANDARD.md`
- `docs/CODEX_PROJECT_UNDERSTANDING.md`
- `docs/IMPORT_ENGINE_QA_AUDIT.md`
- `docs/IMPORT_ENGINE_MODEVA_DRY_RUN.md`
- `docs/IMPORT_ENGINE_MODEVA_REAL_RUN.md`
- `src/import/`
- relevant Supabase migrations for buildings, units, and unit price history

## Executive Summary

The RC3 Import Engine is architecturally sound for its current release scope: validating source packages, blocking incomplete projects, creating deterministic dry-run plans, preserving missing facts, and planning Project, Building, Unit, and Price History operations without database writes.

The strongest parts of the design are the separation between validation, dataset loading, planning, relationship validation, rollback intent, and database execution; the explicit import state machine; the dry-run-first behavior; and the package readiness gate that blocks Coralina before plan creation.

RC3 is not a full production execution release for the expanded Project + Buildings + Units + Price History stage. Execute mode is intentionally blocked for the current stage until the write path is explicitly approved. That is the correct safety posture, but it means RC3 should be released as a dry-run planning and validation release, not as a general real-import release for all future projects.

## Scores

Overall score: 84 / 100

Architecture score: 88 / 100

Code quality score: 82 / 100

Documentation quality score: 86 / 100

Scalability score: 78 / 100

Maintainability score: 84 / 100

## Release Decision

RC3 is officially ready for release with scope limits.

Approved release scope:

- Source package validation.
- Blocked-project safety behavior.
- Dry-run import planning for Project, Buildings, Units, and Price History.
- Relationship validation for duplicate buildings, duplicate units, duplicate price-history source keys, orphan references, invalid prices, missing price dates, and currency warnings.
- Continued Coralina source intake preparation.
- Future media/documents dry-run planning work, provided database writes remain disabled until separately approved.

Not approved in RC3:

- Execute mode for the expanded Project + Buildings + Units + Price History stage.
- Media import execution.
- Document import execution.
- Source record import execution.
- Intelligence persistence.
- Passport snapshot persistence.
- CRM, Website, or AI Factory write integrations.

## Architecture Review

The Import Engine is organized around a clear pipeline:

1. Load manifest.
2. Load extracted datasets.
3. Validate package readiness.
4. Block incomplete packages before plan creation.
5. Create deterministic import plan.
6. Validate relationships.
7. Complete dry-run safely.
8. Block execute mode for the current expanded stage.

This is the right shape for Forever's "One Engine, Many Interfaces" direction. The import plan is a strong architectural boundary because future engines can consume the same normalized planning outputs before data is written or reused elsewhere.

Strengths:

- `src/import/importer.ts` keeps orchestration explicit and readable.
- `src/import/planner.ts` centralizes canonical Project, Building, Unit, and Price History mapping.
- `src/import/plan-validator.ts` separates relationship checks from package readiness checks.
- `src/import/database.ts` isolates Supabase client creation and write behavior.
- `src/import/state-machine.ts` prevents accidental lifecycle drift.
- `src/import/rollback.ts` defines rollback intent without pretending unsupported rollback is complete.

Risks:

- `planner.ts` is already carrying several responsibilities: fact extraction, unit-plan mapping, price-list fallback, building derivation, price-history mapping, date normalization, numeric parsing, and operation creation. This is manageable in RC3, but it will become too large as media, documents, sources, Intelligence, and Passport stages are added.
- The import plan currently stores some broad `Record<string, unknown>` payloads. That helps speed, but future engines will need stronger canonical types to prevent schema drift.
- The architecture does not yet define a stable stage interface such as `ImportStage`, `StagePlanner`, or `StageValidator`. Adding each new stage directly to `planner.ts` will increase coupling.

## Scalability Review

RC3 should scale to additional small and medium project packages in dry-run mode. The Modeva dry-run plans 586 operations: 1 Project, 7 Buildings, 289 Units, and 289 Price History rows. That is a useful proof point for the current data size.

Scaling concerns:

- Plan validation uses in-memory arrays and maps. This is fine for current project-scale imports, but very large inventory packages may need streaming, chunking, or paged validation.
- The dormant database layer writes buildings, units, and price history row-by-row. Before execute mode is re-enabled for the expanded stage, bulk upsert or transaction/RPC execution should be considered.
- Duplicate detection is plan-local. Cross-project and existing-database duplicate checks are not part of dry-run because dry-run intentionally avoids Supabase access.
- The current stage relies heavily on `price-list.json` shape. More developers and more extraction formats will likely expose shape variance.

Scalability verdict: good for RC3 dry-run scope, not yet sufficient for high-volume or multi-project batch execution.

## Maintainability Review

Maintainability is solid because module boundaries are easy to understand and the public exports are collected in `src/import/index.ts`.

Strengths:

- Small infrastructure modules: manifest, datasets, validator, plan-validator, rollback, state-machine.
- Clear safety gate in `importer.ts`.
- Shared types in `types.ts`.
- Dry-run safety is easy to audit.

Maintainability debt:

- Planner logic should be decomposed before v2. Suggested future modules: `facts.ts`, `project-planner.ts`, `building-planner.ts`, `unit-planner.ts`, `price-history-planner.ts`, `normalizers.ts`, and `stage-registry.ts`.
- Validation rules are split sensibly today, but package readiness, dataset schema validation, and relationship validation will need a more formal rule registry as source packages diversify.
- Some documentation still reflects earlier execution-capable v1 behavior, while RC3 correctly blocks execute mode for the expanded stage. Status docs should continue to be precise about this distinction.
- `logger.ts` contains mojibake check/cross symbols. This is cosmetic but should be cleaned up before logs become operator-facing release artifacts.

## Code Quality Review

The code is direct, readable, and conservative. It favors explicit checks over clever abstraction, which is appropriate for an import system where safety matters more than elegance.

Positive findings:

- Dry-run does not create a Supabase client.
- Packages with `ready_for_import=false` stop before plan creation.
- Required manifest fields containing `SOURCE_PENDING` are blocking errors.
- Missing optional facts remain null.
- Price fields are stripped from Unit operations when price-list rows are used as the unit source.
- Price History rows preserve source date and source metadata in the plan.

Quality concerns:

- There is no dedicated automated test suite for the Import Engine modules. Current confidence comes from dry-runs, TypeScript validation, and documented audits.
- Extracted dataset shape validation is lightweight. Invalid JSON fails loudly, but semantically malformed JSON can pass until later mapping or relationship validation.
- Date normalization only handles one explicit date pattern. Additional source formats may silently pass through.
- Currency policy is unresolved: dry-run preserves explicit null currency and warns, while the database write layer defaults null currency to `THB`. Before execute mode resumes, this policy must be unified.
- The existing database layer still contains earlier execution code that is not currently reachable for RC3. Keeping unreachable write code can confuse future maintainers unless docs and code comments remain clear.

## Documentation Quality Review

Documentation quality is strong. The architecture document, QA audit, Modeva dry-run, Modeva real-run, Coralina validation, status, roadmap, and data standard form a clear operational record.

Strengths:

- The documentation clearly states dry-run behavior and current scope limits.
- Coralina blockers are documented without inventing facts.
- Modeva validation history records both dry-run and real idempotency evidence.
- The Data Standard defines the future target model for Project, Developer, Location, Building, Unit, Price History, Documents, Media, Intelligence, and Passport.

Documentation risks:

- Compatibility pointer docs are useful but can hide where canonical truth lives unless tasks continue reading the index first.
- Earlier docs that say Import Engine v1 can upsert core data are historically true for FDB-003C, but RC3's expanded stage now blocks execute mode. Future docs should consistently distinguish historical v1 execution from current RC3 execution readiness.
- There is not yet a standard release-review template or intake-report template. RC3 would benefit from making this document a repeatable format for RC4 and future project intakes.

## Error Handling Review

Current error handling is appropriate for dry-run release scope.

Strengths:

- Missing or malformed manifest data fails early.
- Invalid JSON fails loudly.
- Incomplete packages return a structured blocked summary instead of throwing as an agent/runtime failure.
- Relationship validation errors stop the import before dry-run completion.
- Warnings are grouped by issue code in dry-run output.

Gaps:

- Relationship validation errors currently throw after plan creation rather than returning a structured failed summary.
- There is no persisted import run record or immutable validation artifact.
- There are no error classes or machine-readable error categories beyond validation issue codes.
- Rollback failure paths are not exercised because execute mode is blocked.

## Validation Flow Review

Validation is layered correctly:

- Manifest shape validation.
- Manifest version validation.
- Required metadata validation.
- `SOURCE_PENDING` blocking.
- `import-status.json` readiness validation.
- Required folder/file validation.
- Extracted JSON availability validation.
- Relationship and duplicate validation after plan creation.

The flow matches the Forever Data Standard's core rule: validation must happen before import, and dry-run must pass before real import.

Main gap:

- Dataset schema validation is still implicit. The engine knows how to map expected rows, but it does not formally validate extracted file schemas before planning. This is acceptable for RC3 but should be addressed before third-party or AI-generated extraction outputs are trusted at scale.

## Import Pipeline Review

The pipeline is safe and deterministic for RC3.

Current supported dry-run entities:

- Project.
- Buildings.
- Units.
- Unit Price History.

Current excluded entities:

- Media.
- Documents.
- Source records.
- Project assets.
- Relationships beyond import dependencies.
- Intelligence.
- Passport snapshots.

Important finding:

The pipeline is safer than a partial execute release because it blocks execute mode for the expanded stage. That prevents the stale or incomplete write path from accidentally becoming the release behavior.

## Rollback Strategy Review

Rollback is designed as a contract, not as a complete execution mechanism.

Strengths:

- Dry-run correctly requires no rollback.
- Execute-mode rollback intent is expressed in reverse dependency order.
- The docs do not overclaim transaction safety.

Risks:

- No automatic rollback exists for failed writes.
- No transaction-scoped database execution exists.
- No prior-row snapshots are captured.
- No immutable import audit record is written.

Required before execute mode:

- Transaction or RPC-backed execution.
- Snapshot capture for every upsert.
- Deterministic delete/restore behavior for new and existing rows.
- Audit log entries for started, completed, failed, and rolled-back imports.

## Dry-Run Safety Review

Dry-run safety is one of RC3's strongest areas.

Evidence:

- Dry-run returns before database client creation.
- Coralina blocks with zero operations.
- Modeva dry-run plans expected counts.
- Execute mode is explicitly disabled for the current expanded stage.

Verdict: dry-run safety is release-ready.

## Code Organization Review

The current folder structure is appropriate:

```text
src/import/
  cli.ts
  manifest.ts
  validator.ts
  datasets.ts
  planner.ts
  plan-validator.ts
  state-machine.ts
  rollback.ts
  database.ts
  importer.ts
  types.ts
```

The organization is strong for RC3. The next organization improvement should be stage decomposition before adding media, documents, source records, Intelligence, Passport, CRM, Website, or AI Factory integrations.

## Technical Debt Assessment

Debt level: moderate and acceptable for RC3, but should be paid before execute-mode expansion.

Technical debt items:

- Planner module has accumulated too much stage-specific mapping logic.
- No formal extracted JSON schemas.
- No automated unit/integration tests dedicated to Import Engine modules.
- Currency policy is not unified between planning validation and dormant database execution.
- Rollback is a skeleton.
- Execute code exists but is intentionally unreachable for the current stage.
- Row-by-row write paths will not scale well when execution returns.
- Import run results are logged but not persisted as audit artifacts.
- No canonical stage registry exists.
- Media/document/source/intelligence/passport boundaries are not yet implemented.

## Architectural Risks

High priority:

- Enabling execute mode before transaction-backed rollback and currency policy are resolved.
- Adding media/documents directly into `planner.ts` without a stage abstraction.
- Treating current Modeva source shape as universal.
- Allowing Intelligence or Passport outputs to depend on unstored assumptions.

Medium priority:

- Divergence between UI display tables and normalized canonical tables.
- Stale Supabase generated types after schema expansion.
- Historical docs implying broader execute readiness than current RC3 scope.
- Database idempotency depending too much on application logic where unique constraints are missing.

Low priority:

- Logger mojibake.
- Compatibility pointer docs requiring careful index usage.

## Duplicated Logic

No severe duplication was found, but some normalization logic is beginning to repeat conceptually:

- `slugify` exists in both planner/database-adjacent contexts.
- Source-backed fact reading, scalar coercion, number parsing, and date normalization are embedded in planner logic.
- Duplicate/natural-key logic is split between operation creation, plan validation, and database idempotency behavior.

Recommendation: extract shared normalizers and key builders before the next stage.

## Missing Abstractions

Recommended future abstractions:

- `ImportStage` interface with `plan`, `validate`, `summarize`, and optional `execute`.
- Dataset schema validators using `zod` or an equivalent structured validator already available in the project.
- Shared `NaturalKeyBuilder`.
- Shared `SourceEvidence` type.
- Import run/audit writer.
- Transaction-backed execution adapter.
- Stage registry for Project, Buildings, Units, Price History, Media, Documents, Sources, Intelligence, and Passport.

## Performance Bottlenecks

Current bottlenecks are not release blockers for dry-run.

Potential future bottlenecks:

- Large JSON files are loaded fully into memory.
- Plan validation is in-memory and project-local.
- Database execution, when re-enabled, currently loops row-by-row.
- Database duplicate checks in the dormant write layer perform per-row lookups for units and price-history rows.

Recommended future performance work:

- Batch database writes.
- Transaction/RPC execution.
- Optional streaming or chunked validation for large source packages.
- Precomputed maps for existing database records during execute dry-checks.

## Future Compatibility

### Knowledge Engine

Compatibility is promising but incomplete. The import plan preserves source metadata for units and price history, but it does not yet create source graph records or fact-level provenance across all entities.

Needed:

- Canonical source records.
- Fact IDs or source-evidence references.
- Immutable import audit trail.

### Intelligence Engine

Compatibility is good at the data-standard level but incomplete in implementation. The Import Engine prepares structured Project, Unit, and Price History data, which Intelligence can consume later.

Needed:

- Persisted source-backed intelligence inputs.
- Explicit Intelligence readiness validation.
- No recommendations based on unstored assumptions.

### Passport Engine

Compatibility is good conceptually. Passport requires canonical project identity, score/verdict inputs, risks, and verification dates. RC3 imports/plans only the foundation.

Needed:

- Passport snapshot strategy.
- Verification date policy.
- Canonical relationship between Passport, Intelligence, and imported source facts.

### Website

Compatibility is safe because RC3 does not modify UI or public routes. The bigger future risk is dual-model drift between current display fields and normalized canonical tables.

Needed:

- Clear migration path from display-oriented fields to canonical imported records.
- Website read models that can consume Import Engine outputs without duplicating business logic.

### CRM

Compatibility is early. The Import Engine can provide verified project/unit inventory, but buyer-fit, lead, and sales workflow data are outside current scope.

Needed:

- CRM-safe project/unit APIs or views.
- Availability-change history.
- Buyer-fit metadata boundaries.

### AI Factory

Compatibility depends on source-backed provenance. RC3 is directionally compatible because it avoids guessing and keeps missing facts missing.

Needed:

- Machine-readable validation artifacts.
- Source graph and extraction confidence records.
- Repeatable import run outputs that AI workflows can inspect without touching production data.

## Recommendations

Required before enabling execute mode:

1. Resolve currency policy for explicit null currency versus default Phuket `THB`.
2. Implement transaction/RPC-backed execution for the expanded stage.
3. Capture prior-row snapshots and write immutable import audit records.
4. Add database-level uniqueness where safe, especially for unit identity if the schema permits.
5. Add Import Engine automated tests for manifest validation, blocked packages, plan creation, relationship validation, dry-run safety, and execute-mode blocking.

Recommended before adding media/documents:

1. Define canonical source, document, media, image, video, and project asset boundaries.
2. Add a stage abstraction before expanding `planner.ts`.
3. Add extracted JSON schema validation.
4. Create a reusable intake validation report template.
5. Keep media/documents in dry-run planning until relationship validation and duplicate prevention are proven.

Recommended before Knowledge/Intelligence/Passport integration:

1. Introduce fact-level source evidence identifiers.
2. Persist validation artifacts.
3. Define Passport snapshot ownership.
4. Define whether Intelligence is generated on demand, persisted, or snapshotted.
5. Regenerate Supabase TypeScript types after schema changes are confirmed.

## Final Verdict

RC3 is ready for official release as a dry-run validation and planning release.

RC3 is not ready as an execute-mode release for the expanded Project + Buildings + Units + Price History stage.

This is a good release candidate because it chooses safety over premature database writes. The Import Engine is well-positioned for the next source-backed intake, but the next release should pay down stage abstraction, schema validation, rollback, audit, and transaction debt before expanding execution.

