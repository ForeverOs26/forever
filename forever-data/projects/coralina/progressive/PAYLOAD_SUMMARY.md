# Coralina Progressive draft payload

- Contract: `public.forever_progressive_ingest(jsonb)`, schema version `1`, create mode.
- Payload: `payload.json`.
- Project: `The Title Coralina Kamala`, slug `coralina`.
- Intended state: draft, never published (`publish=false`); the RPC creates `public_status=draft`, `is_active=true`, and `forever_verified=false` by contract.
- Graph: 1 project, 8 buildings, 198 units, 198 price-history rows, 0 media, 0 documents, 6 warnings, 1 ingestion batch.
- Canonical links: developer and location IDs are null; exact raw identities are retained.
- Price currency: THB inferred from source-verified Thailand under `project_country_default_currency` v1.0.0, status `inferred_default`, confidence `medium`.
- Batch fingerprint: `9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c`.
- Payload SHA-256: `2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605`.

Expected permanent database delta is derived from the payload: +1 project, +8 buildings, +198 units, +198 unit-price-history rows, +6 ingestion warnings, and +1 ingestion batch; no media or document rows.
