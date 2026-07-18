$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$entry = Join-Path $root 'verify-progressive-ingestion-production.ps1'
$runtime = Join-Path $env:TEMP ('progressive-harness-tests-' + [Guid]::NewGuid().ToString('N'))
try {
  $output = & $entry -OfflineSelfTest -RuntimeDirectory $runtime 2>&1 | Out-String
  if ($output -notmatch 'OFFLINE_SELF_TESTS_COMPLETE') { throw "Offline harness tests failed: $output" }
  $trackedSql = Get-ChildItem -LiteralPath $root -Filter '*.sql' -File
  foreach ($file in $trackedSql) {
    $content = Get-Content -Raw -LiteralPath $file.FullName
    if ($content -match 'regprocedure\s*::\s*regclass') { throw "regprocedure-to-regclass regression: $($file.Name)" }
    if ($content -match 'pg_stat_ssl') { throw "pg_stat_ssl client TLS regression: $($file.Name)" }
    if ($content -match "'[^']*'\s*\|\|\s*(relkind|prokind|relpersistence)(?!::text)") { throw "internal char concatenation regression: $($file.Name)" }
  }
  $baseline = Get-Content -Raw -LiteralPath (Join-Path $root 'progressive-ingestion-baseline.sql')
  if ($baseline -notmatch 'ORDER BY row_json' -or $baseline -notmatch 'relkind::text' -or
      $baseline -notmatch 'relpersistence::text' -or $baseline -notmatch 'prokind::text' -or
      $baseline -notmatch 'strict_object_sha256' -or $baseline -notmatch "prokind::text IN \('f', 'p'\)") {
    throw 'Catalog determinism/type-cast/ordinary-routine coverage missing.'
  }
  $smoke = Get-Content -Raw -LiteralPath (Join-Path $root 'progressive-ingestion-smoke.sql')
  foreach ($marker in @('SMOKE_BEGIN_CONFIRMED', 'SMOKE_RPC_RETURNED', 'SMOKE_INSIDE_ASSERTIONS_COMPLETE', 'SMOKE_EXPLICIT_ROLLBACK_COMPLETE')) {
    if ($smoke -notmatch $marker) { throw "Smoke marker missing: $marker" }
  }
  if ($smoke -notmatch 'SET LOCAL ROLE service_role' -or $smoke -notmatch 'SMOKE_INSIDE_JSON') { throw 'Service-role smoke evidence missing.' }
  $residue = Get-Content -Raw -LiteralPath (Join-Path $root 'progressive-ingestion-zero-residue.sql')
  foreach ($required in @('unit_price_history', 'import_execution_approvals', 'import_execution_receipts', 'RESIDUE_JSON')) {
    if ($residue -notmatch $required) { throw "Complete residue coverage missing: $required" }
  }
  $harness = Get-Content -Raw -LiteralPath $entry
  foreach ($required in @('result.json', 'report.md', 'verify-full', 'TLS may only be disabled for a disposable loopback database')) {
    if ($harness -notmatch [regex]::Escape($required)) { throw "Harness security/evidence coverage missing: $required" }
  }
  Write-Output 'HARNESS_REGRESSION_TESTS_COMPLETE'
} finally {
  if (Test-Path -LiteralPath $runtime) { Remove-Item -Recurse -Force -LiteralPath $runtime }
}
