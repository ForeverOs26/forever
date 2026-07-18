# Forever Progressive Ingestion — Final Integration Report

Date: 2026-07-18
Repository: `C:\forever`
Branch: `main`

## Outcome

Progressive project ingestion was integrated as the ordinary import lane,
validated against the full repository migration chain in a disposable local
Supabase PostgreSQL 17.6.1 database, regression-tested, built, and committed
locally. The strict RC5.5D/RC5.6P lane was not changed or executed.

## Git baseline and result

| Item | Starting value | Ending value |
|---|---|---|
| HEAD | `f7015ea514cd9d38c564e349f7bfa94a1ef1e15c` | `be6880a72a6c1c84e517add7d1089c0c2d23dbe6` |
| Tree | `78280c4d0ea7e150f863752e9d6d4c8a1ba66505` | `99ac14c33818114fd3cf832cd5d206d21f282ffe` |
| Branch | `main` | `main` |
| Ahead/behind `origin/main` | ahead 2, behind 0 | ahead 3, behind 0 |

Both protected local commits were present and are ancestors of the result:

- `c71b2ec5d6084f35d082a35028ebcd2be661734f`
- `f7015ea514cd9d38c564e349f7bfa94a1ef1e15c`

The tracked worktree and staging area were clean before patch application.
Many unrelated, pre-existing untracked evidence/handoff files were present;
they were preserved and were not staged. The tracked worktree is clean after
the commit. This report was generated after the commit so it can truthfully
record the commit hash; it is the requested final local report artifact.

## Handoff patch

- Baseline content equivalence: confirmed exactly. The current pre-patch tree
  was `78280c4d...`, identical to the tree recorded by the Claude handoff.
- `git apply --check`: passed without conflicts, fuzz, or adaptation.
- Patch application: passed.
- No semantic or textual changes under `src/import/`.
- No `forever_import` or `forever_execution` SQL object was changed.
- No credential, secret, connection string, or environment file entered the
  committed diff.

## Corrections made to the Claude patch

1. Provenance filtering now writes only accepted provenance back into project,
   building, unit, price, and media payloads. Nested metadata merges preserve
   existing `owner_verified` stamps instead of replacing the entire map.
2. A ready `ProgressiveBatch` is permitted only for dry-run/static inspection.
   Live CLI execution rejects it with
   `progressive_ingestion: ready_batch_live_execution_forbidden` and rebuilds
   from `BuildBatchInput` after dependency/current-state reads.
3. Existing price and media values/provenance are loaded. Matching weaker price
   updates are omitted with `field_conflict`; genuinely new dated/source-backed
   rows append. Media title/sort order are presence- and precedence-protected.
4. The trusted TypeScript boundary and RPC require `schema_version = "1"` and
   reject non-array `buildings`, `units`, `prices`, `media`, or `warnings` with
   stable technical errors before writes.
5. Dependency lookup no longer interpolates names into `.or(...)`. It performs
   separate exact equality queries for slug and name, then de-duplicates by id.
   Punctuation-heavy names are covered by tests.
6. `project_media.metadata` was added for provenance. SQL metadata updates now
   deep-merge `field_provenance` for buildings, units, prices, and media.
7. Focused trusted-boundary, provenance, price/media, punctuation, schema-shape,
   and real PostgreSQL/RLS tests were added.

## Migration

Authoritative migration:

`supabase/migrations/20260718113000_progressive_ingestion_v1.sql`

The docs directory contains only a pointer README, so there is no second SQL
copy that can drift. Generated Supabase types were not regenerated because the
installed Supabase launcher's native Go binary is blocked by Windows
Application Control. The existing explicit optional project-detail type
extension remains and must be replaced by regenerated types after a future
authorized migration application.

## Isolated PostgreSQL verification

Runtime: cached `public.ecr.aws/supabase/postgres:17.6.1.143`, exposed only as a
disposable local container on port 55432. The normal Supabase launcher could
not spawn `supabase-go.exe` due Windows Application Control, so the same cached
Supabase PostgreSQL image was run directly. A minimal local `storage.objects`
bootstrap was supplied because that table normally comes from the Storage
service. The container was stopped and removed after testing.

Preflight findings:

- Full existing migration chain applied from zero.
- All progressive migration table/column references resolved during real apply.
- Every targeted DROP POLICY name existed on its stated table.
- `public.set_updated_at()` existed before the listings trigger.
- `sha256(bytea)` returned the expected digest.
- `project_media(project_id, media_type, url)` had zero duplicate groups in the
  full-chain seeded database.
- Existing strict SQL and TypeScript writers explicitly supply currency.
- `service_role` had the required table privileges.
- Existing strict privilege/security audits passed with the public RPC present.
- The RPC is non-`SECURITY DEFINER` (`prosecdef = false`), has an empty
  `search_path`, and grants execute only to `service_role` plus database owners;
  anon/authenticated have no execute grant and actual role-switched calls fail
  with `permission denied for function forever_progressive_ingest`.
- 19 public policies are publication-scoped after migration (parent plus 18
  project-scoped child policies).

Real PostgreSQL/RLS results: all passed.

1. Migration applies from the full chain.
2. Minimal name-only project draft succeeds.
3. Null developer/location ids succeed.
4. Raw names are preserved.
5. Unresolved dependencies persist warnings without rollback.
6. Rich 1 + 8 + 198 + 198 batch succeeds in one RPC call.
7. Exact replay returns `replayed=true` and row counts do not change.
8. Reused fingerprint with changed content fails.
9. Unrelated create using an existing slug fails.
10. Invalid child data rolls back the complete transaction.
11. Unit-only enrichment resolves an existing same-project building.
12. Price-only enrichment leaves building/unit/media counts unchanged.
13. Unknown currency is stored as NULL.
14. Draft project is invisible to anon.
15. Draft units/media/prices/documents are invisible to anon.
16. Explicit service-role publish makes permitted parent/child data visible.
17. Unpublish hides parent/child data again.
18. `service_role` calls the RPC successfully.
19. Anon/authenticated calls receive function permission denial.
20. Another project's child cannot be updated through the batch project.

The reusable harness is
`src/features/forever-ingestion/tests/progressive-ingest.postgres.sql`.

## Repository validation

| Validation | Result |
|---|---|
| Focused progressive + project-detail tests | 6 files, 53/53 passed |
| Progressive, project detail, strict import, Coralina, Forever Import/Database regressions | 57 files, 877/877 passed |
| Owner-machine Coralina importer-preflight | 3/3 passed, including stable 405-operation dry run |
| Strict execution/security/privilege regressions | passed unchanged |
| TypeScript `tsc --noEmit` | passed |
| Production `vite build` | passed |
| `git diff --check` | passed |
| Browser bundle scan | clean |

The browser scan found no `SUPABASE_SERVICE_ROLE_KEY`, service-role material,
`forever_progressive_ingest`, `createServiceRoleClient`, ready-batch policy
string, or owner CLI marker under `.output/public`.

## Listing status

Deferred explicitly. This integration contains the listings schema and a
tested draft builder/link-patch helper, but no callable service-role listing
write path. Create draft, publish/unpublish, and later project-link persistence
are the next small isolated follow-up. No marketplace/resale UI was added, and
the code comments no longer imply that persistence is already callable.

## Complete committed file list

1. `docs/progressive-ingestion/README.md`
2. `package.json`
3. `src/features/forever-ingestion/batch-types.ts`
4. `src/features/forever-ingestion/build-batch.ts`
5. `src/features/forever-ingestion/cli-payload.ts`
6. `src/features/forever-ingestion/cli.ts`
7. `src/features/forever-ingestion/dependency-resolution.ts`
8. `src/features/forever-ingestion/existing-state.ts`
9. `src/features/forever-ingestion/index.ts`
10. `src/features/forever-ingestion/ingest-client.ts`
11. `src/features/forever-ingestion/listings.ts`
12. `src/features/forever-ingestion/provenance.ts`
13. `src/features/forever-ingestion/tests/build-batch.test.ts`
14. `src/features/forever-ingestion/tests/fake-ingest-executor.ts`
15. `src/features/forever-ingestion/tests/listings.test.ts`
16. `src/features/forever-ingestion/tests/migration-contract.test.ts`
17. `src/features/forever-ingestion/tests/progressive-ingest.postgres.sql`
18. `src/features/forever-ingestion/tests/progressive-ingest.test.ts`
19. `src/features/forever-ingestion/tests/trusted-boundary.test.ts`
20. `src/features/project-detail/components/ProjectDeveloper.tsx`
21. `src/features/project-detail/project-detail-mappers.ts`
22. `src/features/project-detail/project-detail-types.ts`
23. `src/features/project-detail/raw-fallback.test.ts`
24. `supabase/migrations/20260718113000_progressive_ingestion_v1.sql`

## Local commit

`be6880a72a6c1c84e517add7d1089c0c2d23dbe6`
Subject: `feat(database): add progressive project ingestion`

The commit was not pushed.

## Explicit confirmations

- No production database connection occurred.
- No production or linked migration was applied.
- No production database password was requested or used.
- No approval was registered.
- RC5.6P was not executed.
- Coralina V16 was not prepared.
- Nothing was pushed to GitHub or any remote.
- `c71b2ec` and `f7015ea` were not rewritten, squashed, reverted, amended, or weakened.
- No credential exposure occurred.
