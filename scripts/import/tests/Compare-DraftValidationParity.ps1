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
  # Windows PowerShell does not inherit an outer process's -ExecutionPolicy.
  # Pass Bypass only to this disposable validation child; no machine, user, or
  # repository policy is changed. pwsh does not need this Windows-only switch.
  $arguments = @('-NoProfile')
  if ($PSVersionTable.PSEdition -eq 'Desktop') { $arguments += @('-ExecutionPolicy', 'Bypass') }
  $arguments += @('-File', $Importer, '-PayloadPath', $PayloadPath, '-ValidateOnly')
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

# Shared generated matrix: all six importer arrays must preserve zero/one/many
# counts. Explicit null and every scalar shape must fail with the array-type
# diagnostic. Non-empty documents are arrays, but reject at the separate
# ordinary-importer documents boundary.
$arrayCorpus = Get-Content -Raw -LiteralPath (Join-Path $CorpusDir 'array-shapes.json') | ConvertFrom-Json
$validBasePath = Join-Path $CorpusDir 'valid-minimal.json'
$validBaseText = Get-Content -Raw -LiteralPath $validBasePath
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("forever-array-corpus-{0}" -f [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($tempDir) | Out-Null
try {
  foreach ($field in $arrayCorpus.fields) {
    foreach ($shape in $arrayCorpus.shapes) {
      $valueJson = switch ([string]$shape.name) {
        'zero' { '[]' }
        'one' { '[{}]' }
        'multi' { '[{},{},{}]' }
        'null' { 'null' }
        'object' { '{}' }
        'string' { '"not-an-array"' }
        'number' { '7' }
        'boolean' { 'true' }
        default { throw "Unknown shared array shape: $($shape.name)" }
      }
      $caseName = "array-{0}-{1}" -f $field, $shape.name
      $casePath = Join-Path $tempDir ($caseName + '.json')
      $trimmed = $validBaseText.TrimEnd()
      $payloadText = $trimmed.Substring(0, $trimmed.Length - 1) + ",`n  `"$field`": $valueJson`n}`n"
      [IO.File]::WriteAllText($casePath, $payloadText, [Text.UTF8Encoding]::new($false))
      $result = Invoke-ValidateOnly $casePath
      $hasMarker = $result.Stdout -match 'DRAFT_PAYLOAD_VALID\|'
      $arrayCount = switch ([string]$shape.name) {
        'zero' { 0 }
        'one' { 1 }
        'multi' { 3 }
        default { $null }
      }
      $isDocumentContent = $field -eq 'documents' -and $shape.is_array -and $arrayCount -gt 0
      $want = if ($shape.is_array -and -not $isDocumentContent) { 'accept' } else { 'reject' }
      $verdict = if ($result.ExitCode -eq 0 -and $hasMarker) { 'accept' } else { 'reject' }
      $problem = $null
      if ($verdict -ne $want) {
        $problem = "expected $want, got $verdict (exit $($result.ExitCode))"
      } elseif (-not $shape.is_array -and ($result.Stdout + $result.Stderr) -notmatch "payload\.$field must be an array") {
        $problem = 'scalar/null did not reach the fail-closed array-type boundary'
      } elseif ($want -eq 'accept') {
        $count = $arrayCount
        if ($result.Stdout -notmatch "\|${field}=${count}(\||`r?`$)") {
          $problem = "accepted array did not retain count $count in the validation marker"
        }
      }
      if ($problem) { $failures += "${caseName}: $problem" }
      $rows += [pscustomobject]@{
        Case = $caseName
        Expected = $want
        PowerShell = $verdict
        ExitCode = $result.ExitCode
        Marker = $hasMarker
        Match = ($null -eq $problem)
      }
    }
  }
} finally {
  if ([IO.Directory]::Exists($tempDir)) { [IO.Directory]::Delete($tempDir, $true) }
}

$rows | Format-Table -AutoSize | Out-String | Write-Output
if ($failures.Count -gt 0) {
  foreach ($failure in $failures) { Write-Output "MISMATCH: $failure" }
  Write-Error "PowerShell validation parity FAILED: $($failures.Count) mismatch(es)."
  exit 1
}
Write-Output "PowerShell validation parity OK: $($rows.Count) cases agree."
exit 0
