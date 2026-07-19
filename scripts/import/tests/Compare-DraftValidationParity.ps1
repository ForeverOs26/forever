<#
.SYNOPSIS
  Runs the ordinary PowerShell draft-import validation boundary
  (Import-ForeverProjectDraft.ps1 -ValidateOnly) over the shared Fast Intake
  validation corpus and compares accept/reject against expected.json.

.DESCRIPTION
  Each corpus payload is validated through a REAL child PowerShell process
  (current PowerShell executable, -NoProfile -File), capturing stdout, stderr,
  and the true child-process exit code — never a stale in-process
  $LASTEXITCODE. An accepted case must BOTH exit 0 AND print the
  DRAFT_PAYLOAD_VALID| marker; a marker without exit 0, or exit 0 without the
  marker, is a failure.

  This is the live PowerShell half of the TypeScript<->PowerShell
  importer-compatibility proof; the TypeScript half runs in CI
  (src/intake/tests/validation-parity.test.ts) and must never be more
  permissive than this boundary. -ValidateOnly stops before any database
  argument: no host, no password, no psql, no network.
#>

[CmdletBinding()]
param(
  [string]$CorpusDir,
  [string]$Importer
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $CorpusDir) { $CorpusDir = Join-Path $repoRoot 'src/intake/test-fixtures/validation-corpus' }
if (-not $Importer) { $Importer = Join-Path $repoRoot 'scripts/import/Import-ForeverProjectDraft.ps1' }

# The current PowerShell executable (Windows PowerShell or pwsh) as a native
# child process, so the exit code is the process's real exit code.
$psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName

# Same native-argument escaper the importer itself uses (works on Windows
# PowerShell 5.1, which has no ProcessStartInfo.ArgumentList).
function ConvertTo-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\\"') -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-ValidateOnly([string]$PayloadPath) {
  $arguments = @('-NoProfile', '-File', $Importer, '-PayloadPath', $PayloadPath, '-ValidateOnly')
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $psExe
  $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Could not start child PowerShell for $PayloadPath." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdoutTask.GetAwaiter().GetResult()
      Stderr = $stderrTask.GetAwaiter().GetResult()
    }
  } finally {
    $process.Dispose()
  }
}

$expected = Get-Content -Raw -LiteralPath (Join-Path $CorpusDir 'expected.json') | ConvertFrom-Json
$failures = @()
$rows = @()

foreach ($property in $expected.PSObject.Properties) {
  $name = $property.Name
  $want = $property.Value.powershell
  $payloadPath = Join-Path $CorpusDir ("{0}.json" -f $name)
  $result = Invoke-ValidateOnly $payloadPath
  $hasMarker = $result.Stdout -match 'DRAFT_PAYLOAD_VALID\|'

  $verdict = if ($result.ExitCode -eq 0) { 'accept' } else { 'reject' }
  $problem = $null
  if ($result.ExitCode -eq 0 -and -not $hasMarker) {
    $problem = 'exit 0 without DRAFT_PAYLOAD_VALID marker'
  } elseif ($result.ExitCode -ne 0 -and $hasMarker) {
    $problem = "DRAFT_PAYLOAD_VALID marker with non-zero exit $($result.ExitCode)"
  } elseif ($verdict -ne $want) {
    $problem = "expected $want, got $verdict (exit $($result.ExitCode))"
  }
  if ($problem) { $failures += "${name}: $problem" }
  $rows += [pscustomobject]@{
    Case = $name
    Expected = $want
    PowerShell = $verdict
    ExitCode = $result.ExitCode
    Marker = $hasMarker
    Match = ($null -eq $problem)
  }
}

$rows | Format-Table -AutoSize | Out-String | Write-Output
if ($failures.Count -gt 0) {
  foreach ($failure in $failures) { Write-Output "MISMATCH: $failure" }
  Write-Error "PowerShell validation parity FAILED: $($failures.Count) mismatch(es)."
  exit 1
}
Write-Output "PowerShell validation parity OK: $($rows.Count) cases agree."
exit 0
