<#
.SYNOPSIS
  Compares the ordinary PowerShell draft-import validation boundary
  (Import-ForeverProjectDraft.ps1 -ValidateOnly) against the recorded expected
  verdicts for the shared Fast Intake validation corpus.

.DESCRIPTION
  Runs each payload in src/intake/test-fixtures/validation-corpus through
  -ValidateOnly and checks accept/reject against expected.json's `powershell`
  field. Prints a table and exits non-zero on any mismatch.

  This is the Owner-side half of the TypeScript<->PowerShell parity proof; the
  TypeScript half runs in CI (src/intake/tests/validation-parity.test.ts). It
  performs NO database connection: -ValidateOnly stops before any credentials.
#>

[CmdletBinding()]
param(
  [string]$CorpusDir,
  [string]$Importer
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $CorpusDir) { $CorpusDir = Join-Path $repoRoot 'src\intake\test-fixtures\validation-corpus' }
if (-not $Importer) { $Importer = Join-Path $repoRoot 'scripts\import\Import-ForeverProjectDraft.ps1' }

$expected = Get-Content -Raw -LiteralPath (Join-Path $CorpusDir 'expected.json') | ConvertFrom-Json
$mismatches = 0
$rows = @()

foreach ($property in $expected.PSObject.Properties) {
  $name = $property.Name
  $want = $property.Value.powershell
  $payloadPath = Join-Path $CorpusDir ("{0}.json" -f $name)
  $verdict = 'accept'
  try {
    & $Importer -PayloadPath $payloadPath -ValidateOnly | Out-Null
    if ($LASTEXITCODE -ne 0) { $verdict = 'reject' }
  } catch {
    $verdict = 'reject'
  }
  $ok = ($verdict -eq $want)
  if (-not $ok) { $mismatches++ }
  $rows += [pscustomobject]@{ Case = $name; Expected = $want; PowerShell = $verdict; Match = $ok }
}

$rows | Format-Table -AutoSize | Out-String | Write-Output
if ($mismatches -gt 0) {
  Write-Error "PowerShell validation parity FAILED: $mismatches mismatch(es)."
  exit 1
}
Write-Output "PowerShell validation parity OK: $($rows.Count) cases agree."
