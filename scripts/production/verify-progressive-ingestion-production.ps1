[CmdletBinding()]
param(
  [string]$HostName,
  [int]$Port = 5432,
  [string]$Database = 'postgres',
  [string]$UserName,
  [string]$PsqlPath = 'psql',
  [string[]]$PsqlPrefixArguments = @(),
  [string]$PsqlSqlRoot,
  [switch]$PsqlOmitNetworkArguments,
  [string]$SupabasePath = 'supabase',
  [string]$RuntimeDirectory,
  [string]$SslMode = 'verify-full',
  [string]$SslRootCert,
  [switch]$SkipMigrationInventory,
  [switch]$AllowNoTlsForDisposable,
  [switch]$InjectPostRpcAssertionFailure,
  [switch]$OfflineSelfTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:SecretValues = New-Object System.Collections.Generic.List[string]
$script:NativeSteps = New-Object System.Collections.Generic.List[object]
$script:BaselineBefore = $null
$script:BaselineAfter = $null
$script:ZeroResidueConfirmed = $false
$script:StartedAt = [DateTime]::UtcNow
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:FixtureRoot = Join-Path $PSScriptRoot 'tests\fixtures'
$script:Runtime = if ($RuntimeDirectory) { $RuntimeDirectory } else {
  Join-Path $script:RepoRoot ('.codex\runtime\progressive-production-verification\' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
}

function ConvertTo-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Protect-Evidence([string]$Text) {
  if ($null -eq $Text) { return '' }
  $safe = $Text
  foreach ($secret in $script:SecretValues) {
    if (-not [string]::IsNullOrEmpty($secret)) { $safe = $safe.Replace($secret, '[REDACTED]') }
  }
  $safe = [regex]::Replace($safe, '(?i)postgres(?:ql)?://[^\s"'']+', '[REDACTED_POSTGRES_URI]')
  $safe = [regex]::Replace($safe, '(?i)(password|passwd|pwd|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]')
  $safe = [regex]::Replace($safe, '(?i)bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]')
  return $safe
}

function Invoke-NativeCaptured([string]$Name, [string]$Executable, [string[]]$Arguments) {
  if (-not (Test-Path -LiteralPath $script:Runtime)) { New-Item -ItemType Directory -Path $script:Runtime -Force | Out-Null }
  $stdoutPath = Join-Path $script:Runtime ($Name + '.stdout.txt')
  $stderrPath = Join-Path $script:Runtime ($Name + '.stderr.txt')
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Executable
  $psi.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
  $psi.WorkingDirectory = $script:RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw "Native process failed to start: $Executable" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = Protect-Evidence $stdoutTask.GetAwaiter().GetResult()
  $stderr = Protect-Evidence $stderrTask.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
  $process.Dispose()
  $stdout | Set-Content -LiteralPath $stdoutPath -Encoding UTF8
  $stderr | Set-Content -LiteralPath $stderrPath -Encoding UTF8
  $result = [pscustomobject]@{
    Name = $Name; ExitCode = $exitCode; Stdout = $stdout; Stderr = $stderr
    StdoutPath = $stdoutPath; StderrPath = $stderrPath
  }
  $script:NativeSteps.Add([pscustomobject]@{
    name = $Name
    exit_code = $exitCode
    stdout_file = [IO.Path]::GetFileName($stdoutPath)
    stderr_file = [IO.Path]::GetFileName($stderrPath)
    stderr_present = -not [string]::IsNullOrWhiteSpace($stderr)
  })
  return $result
}

function Write-FinalEvidence([string]$Status, [string]$Failure) {
  if (-not (Test-Path -LiteralPath $script:Runtime)) { New-Item -ItemType Directory -Path $script:Runtime -Force | Out-Null }
  $safeFailure = Protect-Evidence $Failure
  $evidence = [ordered]@{
    schema_version = 1
    harness = 'progressive-ingestion-production-verification'
    status = $Status
    started_at_utc = $script:StartedAt.ToString('o')
    completed_at_utc = [DateTime]::UtcNow.ToString('o')
    migration_sha256 = '579234319127c36fa2a203b26d81bdfd86c8d01e8c001e45aa96f9d511632b56'
    tls_mode = if ($AllowNoTlsForDisposable) { 'disabled-disposable-loopback-only' } else { 'verify-full' }
    zero_residue_confirmed = $script:ZeroResidueConfirmed
    baseline_identical = ($null -ne $script:BaselineBefore -and $null -ne $script:BaselineAfter -and
      (($script:BaselineBefore | ConvertTo-Json -Depth 40 -Compress) -eq ($script:BaselineAfter | ConvertTo-Json -Depth 40 -Compress)))
    baseline_before = $script:BaselineBefore
    baseline_after = $script:BaselineAfter
    failure = if ([string]::IsNullOrWhiteSpace($safeFailure)) { $null } else { $safeFailure }
    native_steps = @($script:NativeSteps | ForEach-Object { $_ })
  }
  $jsonPath = Join-Path $script:Runtime 'result.json'
  $markdownPath = Join-Path $script:Runtime 'report.md'
  ($evidence | ConvertTo-Json -Depth 50) | Set-Content -LiteralPath $jsonPath -Encoding UTF8
  $markdown = @(
    '# Progressive Ingestion production verification evidence',
    '',
    "- Status: **$Status**",
    "- TLS: $($evidence.tls_mode)",
    "- Migration SHA-256: ``$($evidence.migration_sha256)``",
    "- Independent zero residue: $($evidence.zero_residue_confirmed)",
    "- Baseline identical: $($evidence.baseline_identical)",
    "- Native steps: $($script:NativeSteps.Count)",
    $(if ($evidence.failure) { "- Failure: $($evidence.failure)" } else { '- Failure: none' })
  ) -join "`n"
  (Protect-Evidence $markdown) | Set-Content -LiteralPath $markdownPath -Encoding UTF8
}

function Require-NativeSuccess($Result, [string]$Label) {
  if ($Result.ExitCode -ne 0) {
    throw "$Label failed with native exit code $($Result.ExitCode): $($Result.Stderr.Trim())"
  }
}

function Parse-MigrationInventory([string]$Text) {
  $trimmed = if ($null -eq $Text) { '' } else { $Text.Trim() }
  if ([string]::IsNullOrWhiteSpace($trimmed)) { throw 'Migration inventory is empty.' }
  $records = @()
  $format = $null
  if ($trimmed.StartsWith('{') -or $trimmed.StartsWith('[')) {
    $format = 'json'
    try { $json = $trimmed | ConvertFrom-Json -ErrorAction Stop } catch { throw ('Malformed migration JSON: ' + $_.Exception.Message) }
    if ($json -is [System.Array]) { $records = @($json) }
    elseif ($json.PSObject.Properties.Name -contains 'migrations') { $records = @($json.migrations) }
    else { $records = @($json) }
  } else {
    $format = 'legacy-table'
    foreach ($line in ($trimmed -split "`r?`n")) {
      if ($line -notmatch '\|') { continue }
      $parts = @($line -split '\|' | ForEach-Object { $_.Trim() })
      if ($parts.Count -ge 2 -and
          ($parts[0] -eq '' -or $parts[0] -match '^\d{14}$') -and
          ($parts[1] -eq '' -or $parts[1] -match '^\d{14}$') -and
          ($parts[0] -ne '' -or $parts[1] -ne '')) {
        $records += [pscustomobject]@{ local = $parts[0]; remote = $parts[1]; time = if ($parts.Count -ge 3) { $parts[2] } else { $null } }
      }
    }
  }
  if ($records.Count -eq 0) { throw "Migration inventory $format contains no records." }
  $seenLocal = New-Object 'System.Collections.Generic.HashSet[string]'
  $seenRemote = New-Object 'System.Collections.Generic.HashSet[string]'
  $localOnly = @(); $remoteOnly = @(); $matching = @()
  foreach ($record in $records) {
    if ($null -eq $record -or $record -is [string] -or $record -is [ValueType]) { throw 'Malformed migration record.' }
    $names = @($record.PSObject.Properties.Name)
    if (-not ($names -contains 'local') -or -not ($names -contains 'remote')) { throw 'Migration record lacks local or remote.' }
    if (@($names | Where-Object { $_ -notin @('local', 'remote', 'time') }).Count -ne 0) { throw 'Migration record has unexpected properties.' }
    if ($null -eq $record.local -or $record.local -isnot [string] -or $null -eq $record.remote -or $record.remote -isnot [string]) { throw 'Migration versions must be strings; empty strings are allowed.' }
    $local = [string]$record.local; $remote = [string]$record.remote
    if (($local -ne '' -and $local -notmatch '^\d{14}$') -or ($remote -ne '' -and $remote -notmatch '^\d{14}$') -or ($local -eq '' -and $remote -eq '')) { throw 'Invalid migration version.' }
    if ($local -ne '' -and -not $seenLocal.Add($local)) { throw "Duplicate local migration version: $local" }
    if ($remote -ne '' -and -not $seenRemote.Add($remote)) { throw "Duplicate remote migration version: $remote" }
    if ($local -ne '' -and $remote -eq '') { $localOnly += $local }
    elseif ($local -eq '' -and $remote -ne '') { $remoteOnly += $remote }
    elseif ($local -eq $remote) { $matching += $local }
    else { throw "Mismatched migration row: local=$local remote=$remote" }
  }
  if ($remoteOnly.Count -ne 0) { throw ('Unexpected remote-only migration versions: ' + ($remoteOnly -join ', ')) }
  return [pscustomobject]@{ Format = $format; Records = @($records); LocalOnly = @($localOnly); RemoteOnly = @($remoteOnly); Matching = @($matching) }
}

function Assert-NoPsqlVariablesInDollarQuotes {
  $failures = @()
  Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.sql' -File | ForEach-Object {
    $content = Get-Content -Raw -LiteralPath $_.FullName
    foreach ($match in [regex]::Matches($content, '(?s)(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$).*?\1')) {
      if ($match.Value -match ":'[A-Za-z_][A-Za-z0-9_]*'") {
        $failures += $_.Name
        break
      }
    }
  }
  if ($failures.Count -ne 0) { throw ('psql variable inside dollar-quoted body: ' + ($failures -join ', ')) }
}

function Invoke-OfflineSelfTests {
  Assert-NoPsqlVariablesInDollarQuotes
  $actual = Get-Content -Raw -LiteralPath (Join-Path $script:FixtureRoot 'supabase-migration-list-2.109.1.json')
  $parsed = Parse-MigrationInventory $actual
  if ($parsed.Format -ne 'json' -or $parsed.LocalOnly.Count -ne 1 -or $parsed.LocalOnly[0] -ne '20260718113000') { throw 'Real JSON fixture classification failed.' }
  Parse-MigrationInventory (Get-Content -Raw -LiteralPath (Join-Path $script:FixtureRoot 'supabase-migration-list-legacy.txt')) | Out-Null
  foreach ($fixture in @('malformed.json', 'duplicate-local.json', 'duplicate-remote.json', 'remote-only.json')) {
    $failed = $false
    try { Parse-MigrationInventory (Get-Content -Raw -LiteralPath (Join-Path $script:FixtureRoot $fixture)) | Out-Null } catch { $failed = $true }
    if (-not $failed) { throw "Negative fixture was accepted: $fixture" }
  }
  $normal = Invoke-NativeCaptured 'self-test-normal-stderr' "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @('-NoProfile', '-NonInteractive', '-Command', "[Console]::Out.Write('{`"local`":`"20260715120000`",`"remote`":`"20260715120000`"}'); [Console]::Error.Write('Connecting to remote database...'); exit 0")
  Require-NativeSuccess $normal 'normal-stderr fixture'
  Parse-MigrationInventory $normal.Stdout | Out-Null
  if ($normal.Stderr -ne 'Connecting to remote database...') { throw 'Normal stderr was not preserved.' }
  $nonzero = Invoke-NativeCaptured 'self-test-nonzero' "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @('-NoProfile', '-NonInteractive', '-Command', "[Console]::Out.Write('{}'); exit 7")
  if ($nonzero.ExitCode -ne 7) { throw 'Native nonzero exit was not preserved.' }
  Write-Output 'OFFLINE_SELF_TESTS_COMPLETE'
}

function Get-PsqlArguments([string]$SqlFile, [hashtable]$Variables) {
  $arguments = @($PsqlPrefixArguments) + @('-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1')
  if ($HostName -and -not $PsqlOmitNetworkArguments) { $arguments += @('-h', $HostName) }
  if ($Port -and -not $PsqlOmitNetworkArguments) { $arguments += @('-p', [string]$Port) }
  if ($UserName) { $arguments += @('-U', $UserName) }
  if ($Database) { $arguments += @('-d', $Database) }
  foreach ($name in ($Variables.Keys | Sort-Object)) { $arguments += @('--set', ($name + '=' + [string]$Variables[$name])) }
  $sqlArgument = $SqlFile
  if ($PsqlSqlRoot -and $SqlFile) {
    $sqlArgument = $PsqlSqlRoot.TrimEnd('/') + '/' + [IO.Path]::GetFileName($SqlFile)
  }
  $arguments += @('-f', $sqlArgument)
  return $arguments
}

function Invoke-PsqlFile([string]$Name, [string]$SqlFile, [hashtable]$Variables = @{}) {
  $result = Invoke-NativeCaptured $Name $PsqlPath (Get-PsqlArguments $SqlFile $Variables)
  Require-NativeSuccess $result $Name
  return $result
}

function Read-MarkerJson([string]$Text, [string]$Marker) {
  $line = @($Text -split "`r?`n" | Where-Object { $_.StartsWith($Marker + '|') })
  if ($line.Count -ne 1) { throw "Expected one $Marker marker, found $($line.Count)." }
  return ($line[0].Substring($Marker.Length + 1) | ConvertFrom-Json -ErrorAction Stop)
}

function Invoke-ResidueCheck([hashtable]$Variables, [string]$Name) {
  $residue = Invoke-NativeCaptured $Name $PsqlPath (Get-PsqlArguments (Join-Path $PSScriptRoot 'progressive-ingestion-zero-residue.sql') $Variables)
  if ($residue.ExitCode -ne 0 -or $residue.Stdout -notmatch '(?m)^ZERO_RESIDUE_COMPLETE\s*$') { throw 'RESIDUE DETECTED' }
  $script:ZeroResidueConfirmed = $true
  return $residue
}

function Invoke-Main {
  Assert-NoPsqlVariablesInDollarQuotes
  if ([string]::IsNullOrWhiteSpace($UserName)) { throw 'UserName is required.' }
  if ([string]::IsNullOrWhiteSpace($HostName)) { throw 'HostName is required.' }
  if ($AllowNoTlsForDisposable) {
    if ($HostName -notin @('localhost', '127.0.0.1', '::1')) { throw 'TLS may only be disabled for a disposable loopback database.' }
  } elseif ($SslMode -ne 'verify-full') {
    throw 'Production verification requires TLS verify-full.'
  }
  if ($PsqlOmitNetworkArguments -and -not $AllowNoTlsForDisposable) {
    throw 'Network arguments may only be omitted for a disposable no-TLS adapter.'
  }
  $migrationPath = Join-Path $script:RepoRoot 'supabase\migrations\20260718113000_progressive_ingestion_v1.sql'
  $migrationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationPath).Hash.ToLowerInvariant()
  if ($migrationHash -ne '579234319127c36fa2a203b26d81bdfd86c8d01e8c001e45aa96f9d511632b56') { throw 'Canonical migration hash mismatch.' }
  if (-not (Test-Path -LiteralPath $script:Runtime)) { New-Item -ItemType Directory -Path $script:Runtime -Force | Out-Null }
  if ($env:PGPASSWORD) { $script:SecretValues.Add($env:PGPASSWORD) }
  $oldSslMode = $env:PGSSLMODE; $oldRootCert = $env:PGSSLROOTCERT
  $finalStatus = 'failed'
  $finalFailure = $null
  try {
    $env:PGSSLMODE = if ($AllowNoTlsForDisposable) { 'disable' } else { $SslMode }
    if ($SslRootCert) { $env:PGSSLROOTCERT = $SslRootCert }

    $tls = Invoke-NativeCaptured '00-client-connection' $PsqlPath ((Get-PsqlArguments '' @{})[0..((Get-PsqlArguments '' @{}).Count - 3)] + @('-c', '\conninfo'))
    Require-NativeSuccess $tls 'client connection attestation'
    if (-not $AllowNoTlsForDisposable -and $tls.Stdout -notmatch '(?i)SSL connection') { throw 'Client-side TLS attestation missing.' }

    if (-not $SkipMigrationInventory) {
      $migration = Invoke-NativeCaptured '01-migration-list' $SupabasePath @('migration', 'list', '--linked')
      Require-NativeSuccess $migration 'Supabase migration list'
      $inventory = Parse-MigrationInventory $migration.Stdout
      if ($inventory.LocalOnly.Count -ne 0 -or $inventory.RemoteOnly.Count -ne 0) { throw 'Migration histories are not synchronized.' }
      if (@($inventory.Matching | Where-Object { $_ -eq '20260718113000' }).Count -ne 1) { throw 'Target migration is not present exactly once.' }
    }

    $preflight = Invoke-PsqlFile '02-preflight' (Join-Path $PSScriptRoot 'progressive-ingestion-preflight.sql')
    if ($preflight.Stdout -notmatch '\[preflight_complete\]' -or $preflight.Stdout -notmatch '(?m)^ROLLBACK\s*$') { throw 'Preflight rollback/completion evidence missing.' }
    $postflight = Invoke-PsqlFile '03-postflight' (Join-Path $PSScriptRoot 'progressive-ingestion-postflight.sql')
    if ($postflight.Stdout -notmatch '\[progressive_rpc_postflight_complete\]' -or $postflight.Stdout -notmatch '(?m)^ROLLBACK\s*$') { throw 'Postflight rollback/completion evidence missing.' }

    $before = Invoke-PsqlFile '04-baseline-before' (Join-Path $PSScriptRoot 'progressive-ingestion-baseline.sql')
    $beforeJson = Read-MarkerJson $before.Stdout 'BASELINE_JSON'
    $script:BaselineBefore = $beforeJson
    $suffix = ([Guid]::NewGuid().ToString('N')).Substring(0, 16)
    $variables = @{
      smoke_slug = 'progressive-verification-' + $suffix
      batch_fingerprint = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash([Text.Encoding]::UTF8.GetBytes($suffix))).Replace('-', '').ToLowerInvariant())
      warning_code = 'progressive_verification_' + $suffix
      raw_developer = 'Verification Developer ' + $suffix
      raw_location = 'Verification Location ' + $suffix
      smoke_project_id = ''
      inject_post_rpc_failure = if ($InjectPostRpcAssertionFailure) { 'true' } else { 'false' }
    }
    $smoke = Invoke-NativeCaptured '05-smoke' $PsqlPath (Get-PsqlArguments (Join-Path $PSScriptRoot 'progressive-ingestion-smoke.sql') $variables)
    $projectMarker = @($smoke.Stdout -split "`r?`n" | Where-Object { $_.StartsWith('SMOKE_RPC_RETURNED|') })
    if ($projectMarker.Count -eq 1) { $variables.smoke_project_id = $projectMarker[0].Substring('SMOKE_RPC_RETURNED|'.Length).Trim() }
    if ($smoke.ExitCode -ne 0) {
      try { Invoke-ResidueCheck $variables '06-zero-residue-after-failed-smoke' | Out-Null } catch { throw 'RESIDUE DETECTED' }
      throw 'SMOKE FAILED AND ZERO RESIDUE CONFIRMED'
    }
    if ($smoke.Stdout -notmatch '(?m)^SMOKE_BEGIN_CONFIRMED\s*$' -or
        $smoke.Stdout -notmatch '(?m)^SMOKE_INSIDE_ASSERTIONS_COMPLETE\s*$' -or
        $smoke.Stdout -notmatch '(?m)^SMOKE_EXPLICIT_ROLLBACK_COMPLETE\s*$') {
      try { Invoke-ResidueCheck $variables '06-zero-residue-after-missing-marker' | Out-Null } catch { throw 'RESIDUE DETECTED' }
      throw 'Smoke transaction completion markers are incomplete; zero residue confirmed.'
    }
    Invoke-ResidueCheck $variables '06-zero-residue' | Out-Null
    $after = Invoke-PsqlFile '07-baseline-after' (Join-Path $PSScriptRoot 'progressive-ingestion-baseline.sql')
    $afterJson = Read-MarkerJson $after.Stdout 'BASELINE_JSON'
    $script:BaselineAfter = $afterJson
    if (($beforeJson | ConvertTo-Json -Depth 20 -Compress) -ne ($afterJson | ConvertTo-Json -Depth 20 -Compress)) { throw 'Permanent counts or fingerprints changed.' }
    $finalStatus = 'passed'
    Write-Output 'PROGRESSIVE_PRODUCTION_VERIFICATION_COMPLETE'
  } catch {
    $finalFailure = Protect-Evidence $_.Exception.Message
    throw
  } finally {
    Write-FinalEvidence $finalStatus $finalFailure
    $env:PGSSLMODE = $oldSslMode; $env:PGSSLROOTCERT = $oldRootCert
    $script:SecretValues.Clear()
  }
}

if ($OfflineSelfTest) { Invoke-OfflineSelfTests } else { Invoke-Main }
