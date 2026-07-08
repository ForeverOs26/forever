# Forever Local Development and Supabase Setup

Status: Official Setup Guide

This document records the local setup process used to connect the Forever repository to Supabase and deploy migrations successfully.

## 1. Prerequisites

- Windows
- Git Bash or PowerShell
- Node.js LTS
- `npm` / `npx`
- Supabase CLI installed as a project dev dependency

## 2. Install Node.js

Install Node.js LTS from the official Node.js website:

- Download Node.js LTS from `nodejs.org`.
- Use the Windows Installer.
- Do not use Docker for normal local setup.

Verify installation:

```powershell
node -v
npm -v
npx -v
```

## 3. Install Supabase CLI

From the Forever repository root:

```powershell
cd C:\forever
npm install --save-dev supabase
npx supabase --version
```

## 4. Supabase Login

```powershell
npx supabase logout
npx supabase login
npx supabase projects list
```

## 5. Link Project

Forever Supabase project ref:

```text
abtvsrcnfwlbawvrjeed
```

Link command:

```powershell
npx supabase link --project-ref abtvsrcnfwlbawvrjeed
```

## 6. Windows PowerShell Note

If PowerShell blocks `npx.ps1`, use `npx.cmd`.

Example:

```powershell
npx.cmd supabase db push
```

## 7. Database Password

`SUPABASE_DB_PASSWORD` is the Supabase database password.

Important:

- Do not commit it.
- Do not share it in chat.
- If the password contains special characters like `!`, prefer PowerShell or proper quoting.

## 8. IPv6 Problem And Fix

Issue:

```text
IPv6 is not supported on current network
```

Fix:

Use the Supabase Session Pooler IPv4 connection string.

Example format:

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

Set the environment variable:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

Run migrations through the pooler URL:

```powershell
npx.cmd supabase db push --db-url $env:SUPABASE_DB_URL
```

## 9. Apply Migrations

Successful command:

```powershell
npx.cmd supabase db push --db-url $env:SUPABASE_DB_URL
```

## 10. Validation Queries

Run:

```sql
SELECT
  (SELECT COUNT(*) FROM projects) AS projects,
  (SELECT COUNT(*) FROM buildings) AS buildings,
  (SELECT COUNT(*) FROM units) AS units,
  (SELECT COUNT(*) FROM unit_price_history) AS price_history;
```

Expected Modeva validation result:

```text
projects: 7
buildings: 7
units: 289
price_history: 289
```

## 11. Important Rules

- Do not run migrations manually in SQL Editor unless explicitly approved.
- Use migrations and `db push` as the official workflow.
- Do not expose service role keys or database passwords.
- Do not delete migrations after they have been applied.
- Use additive migrations only.

## 12. Import Engine

Import Engine v1 imports projects from:

```text
forever-data/projects/
```

Dry-run first:

```powershell
npm run import modeva -- --dry-run
```

Real import:

```powershell
npm run import modeva
```

The import engine requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Important:

- Never commit the service-role key.
- Always run dry-run before real import.
- Use the same pipeline for future projects such as Coralina.

## 13. Current Status

Forever Core Database has been successfully deployed to Supabase.

Modeva import has been validated with:

- 7 buildings
- 289 units
- 289 price history rows

Import Engine v1 has been validated against Modeva:

- Dry-run passed.
- Real import/idempotency test passed.
- No duplicate units were created.
- No duplicate price history rows were created.
