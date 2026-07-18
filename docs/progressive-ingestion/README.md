# Progressive ingestion migration

The verified, authoritative SQL is
`supabase/migrations/20260718113000_progressive_ingestion_v1.sql`.

It was validated from the full local migration chain in a disposable Supabase
PostgreSQL 17.6 database. It has not been applied to any linked or production
database. This directory intentionally contains no second SQL copy.

The repository-owned, read-only applied-state verifier is
`scripts/production/progressive-ingestion-postflight.sql`. Its focused catalog
regression is
`scripts/production/tests/progressive-rpc-search-path-postgres17-regression.sql`.
The verifier requires the single canonical PostgreSQL 17.6 `pg_proc.proconfig`
entry `search_path=""`; missing, mutable, or duplicate `search_path` entries
fail closed.
