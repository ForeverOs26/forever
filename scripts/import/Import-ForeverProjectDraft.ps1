[CmdletBinding(DefaultParameterSetName = 'Project')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Project')]
  [ValidatePattern('^[a-z0-9][a-z0-9-]*$')]
  [string]$Project,

  [Parameter(Mandatory = $true, ParameterSetName = 'Payload')]
  [string]$PayloadPath,

  [switch]$ValidateOnly,
  [string]$HostName,
  [int]$Port = 5432,
  [string]$Database = 'postgres',
  [string]$UserName = 'postgres',
  [string]$SslRootCert,
  [string]$PsqlPath = 'psql',
  [string[]]$PsqlPrefixArguments = @(),
  [string]$ExecutionRole = 'service_role',
  [Security.SecureString]$Password,
  [switch]$DisposableNoTls,
  [switch]$InjectPostRpcVerificationFailure
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-ObjectProperty($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-ArrayCount($Object, [string]$Name) {
  # Reads PSObject.Properties[$Name].Value directly in this scope. Returning the
  # value through a helper-function boundary sends it down the pipeline, which
  # enumerates a one-element JSON array into its scalar element and made valid
  # single-item payloads fail with "must be an array". A missing property stays
  # 0; explicit null, strings, numbers, booleans, and scalar objects reject.
  if ($null -eq $Object) { return 0 }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return 0 }
  $value = $property.Value
  if ($null -eq $value) { throw "payload.$Name must be an array." }
  if ($value -is [string] -or $value -isnot [System.Collections.IList]) { throw "payload.$Name must be an array." }
  return $value.Count
}

function ConvertTo-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\\"') -replace '(\\+)$', '$1$1') + '"'
}

function ConvertTo-SqlLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function ConvertFrom-SecureString([Security.SecureString]$Value) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Psql([string]$Sql, [string]$PlainPassword, [switch]$NoNetworkArguments) {
  $arguments = @($PsqlPrefixArguments) + @(
    '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=terse', '-q', '-t', '-A'
  )
  if (-not $NoNetworkArguments) {
    $arguments += @('-h', $HostName, '-p', [string]$Port)
  }
  $arguments += @('-U', $UserName, '-d', $Database)

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $PsqlPath
  $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['PGPASSWORD'] = $PlainPassword
  $startInfo.EnvironmentVariables['PGSSLMODE'] = if ($DisposableNoTls) { 'disable' } else { 'verify-full' }
  if (-not $DisposableNoTls) { $startInfo.EnvironmentVariables['PGSSLROOTCERT'] = $SslRootCert }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Could not start psql.' }
    $process.StandardInput.Write($Sql)
    $process.StandardInput.Close()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $result = [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdoutTask.GetAwaiter().GetResult()
      Stderr = $stderrTask.GetAwaiter().GetResult()
    }
    if ($result.ExitCode -ne 0) {
      $detail = $result.Stderr.Trim()
      if ([string]::IsNullOrWhiteSpace($detail)) { $detail = 'psql failed without diagnostic output.' }
      throw "Draft import failed safely: $detail"
    }
    return $result
  } finally {
    $process.Dispose()
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($PSCmdlet.ParameterSetName -eq 'Project') {
  $PayloadPath = Join-Path $repoRoot (Join-Path 'forever-data\projects' (Join-Path $Project 'progressive\payload.json'))
}
$PayloadPath = [IO.Path]::GetFullPath($PayloadPath)
if (-not (Test-Path -LiteralPath $PayloadPath -PathType Leaf)) { throw "Payload not found: $PayloadPath" }

$payloadText = [IO.File]::ReadAllText($PayloadPath, [Text.UTF8Encoding]::new($false))
try { $payload = $payloadText | ConvertFrom-Json -ErrorAction Stop }
catch { throw "Payload is not valid JSON: $($_.Exception.Message)" }

$projectPayload = Get-ObjectProperty $payload 'project'
$slug = [string](Get-ObjectProperty $projectPayload 'slug')
$fingerprint = [string](Get-ObjectProperty $payload 'batch_fingerprint')
if ([string]::IsNullOrWhiteSpace($slug) -or $slug -cnotmatch '^[a-z0-9][a-z0-9-]*$') { throw 'payload.project.slug must be a lowercase slug.' }
if ([string](Get-ObjectProperty $payload 'schema_version') -ne '1') { throw 'payload.schema_version must be "1".' }
if ([string](Get-ObjectProperty $payload 'mode') -ne 'create') { throw 'Draft project imports require payload.mode="create".' }
if ($null -eq $projectPayload -or (Get-ObjectProperty $projectPayload 'publish') -ne $false) { throw 'Draft project imports require payload.project.publish=false.' }
if ([string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $projectPayload 'name'))) { throw 'payload.project.name is required.' }
if ($fingerprint -cnotmatch '^[0-9a-f]{64}$') { throw 'payload.batch_fingerprint must be a lowercase SHA-256 hexadecimal value.' }

$counts = [ordered]@{
  projects = 1
  buildings = Get-ArrayCount $payload 'buildings'
  units = Get-ArrayCount $payload 'units'
  prices = Get-ArrayCount $payload 'prices'
  media = Get-ArrayCount $payload 'media'
  documents = Get-ArrayCount $payload 'documents'
  warnings = Get-ArrayCount $payload 'warnings'
  batches = 1
}
if ($counts.documents -ne 0) { throw 'payload.documents is not supported by public.forever_progressive_ingest; import documents separately.' }

$payloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PayloadPath).Hash.ToLowerInvariant()
Write-Output "DRAFT_PAYLOAD_VALID|slug=$slug|sha256=$payloadHash|buildings=$($counts.buildings)|units=$($counts.units)|prices=$($counts.prices)|media=$($counts.media)|documents=$($counts.documents)|warnings=$($counts.warnings)"
if ($ValidateOnly) { return }

if ([string]::IsNullOrWhiteSpace($HostName)) { throw 'HostName is required for an import.' }
if ([string]::IsNullOrWhiteSpace($SslRootCert) -and -not $DisposableNoTls) { throw 'SslRootCert is required; normal imports use PGSSLMODE=verify-full with the official CA.' }
if (-not $DisposableNoTls -and -not (Test-Path -LiteralPath $SslRootCert -PathType Leaf)) { throw "SSL root certificate not found: $SslRootCert" }
if ($DisposableNoTls -and $HostName -notin @('localhost', '127.0.0.1', '::1')) { throw 'DisposableNoTls is limited to a loopback database.' }
if ($ExecutionRole -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'ExecutionRole contains unsupported characters.' }
if ($null -eq $Password) { $Password = Read-Host 'Database password' -AsSecureString }

$delimiter = 'forever_payload_' + [Guid]::NewGuid().ToString('N')
while ($payloadText.Contains('$' + $delimiter + '$')) { $delimiter = 'forever_payload_' + [Guid]::NewGuid().ToString('N') }
$payloadDollarQuote = '$' + $delimiter + '$'
$slugLiteral = ConvertTo-SqlLiteral $slug
$fingerprintLiteral = ConvertTo-SqlLiteral $fingerprint
$roleIdentifier = '"' + $ExecutionRole.Replace('"', '""') + '"'

$transactionSql = @"
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE pg_temp.forever_draft_payload (payload jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO pg_temp.forever_draft_payload (payload) VALUES (${payloadDollarQuote}${payloadText}${payloadDollarQuote}::jsonb);
REVOKE ALL ON TABLE pg_temp.forever_draft_payload FROM PUBLIC;
GRANT SELECT ON TABLE pg_temp.forever_draft_payload TO $roleIdentifier;
DO `$preflight`$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE slug = $slugLiteral) THEN
    RAISE EXCEPTION 'draft_import_duplicate_slug';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ingestion_batches WHERE batch_fingerprint = $fingerprintLiteral) THEN
    RAISE EXCEPTION 'draft_import_duplicate_batch_fingerprint';
  END IF;
END
`$preflight`$;
SET LOCAL ROLE $roleIdentifier;
DO `$ingest`$
DECLARE v_result jsonb;
BEGIN
  SELECT public.forever_progressive_ingest(payload) INTO v_result FROM pg_temp.forever_draft_payload;
  IF COALESCE((v_result->>'replayed')::boolean, false) THEN
    RAISE EXCEPTION 'draft_import_unexpected_replay';
  END IF;
END
`$ingest`$;
DO `$graph`$
DECLARE v_project_id uuid;
BEGIN
  SELECT id INTO STRICT v_project_id FROM public.projects WHERE slug = $slugLiteral AND public_status = 'draft';
  IF (SELECT count(*) FROM public.projects WHERE id = v_project_id) <> $($counts.projects) THEN RAISE EXCEPTION 'draft_import_project_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.buildings WHERE project_id = v_project_id) <> $($counts.buildings) THEN RAISE EXCEPTION 'draft_import_building_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.units WHERE project_id = v_project_id) <> $($counts.units) THEN RAISE EXCEPTION 'draft_import_unit_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.unit_price_history ph JOIN public.units u ON u.id = ph.unit_id WHERE u.project_id = v_project_id) <> $($counts.prices) THEN RAISE EXCEPTION 'draft_import_price_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.project_media WHERE project_id = v_project_id) <> $($counts.media) THEN RAISE EXCEPTION 'draft_import_media_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.documents WHERE project_id = v_project_id) <> $($counts.documents) THEN RAISE EXCEPTION 'draft_import_document_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.ingestion_warnings WHERE project_id = v_project_id) <> $($counts.warnings) THEN RAISE EXCEPTION 'draft_import_warning_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.ingestion_batches WHERE project_id = v_project_id AND batch_fingerprint = $fingerprintLiteral) <> $($counts.batches) THEN RAISE EXCEPTION 'draft_import_batch_count_mismatch'; END IF;
  IF $($InjectPostRpcVerificationFailure.ToString().ToLowerInvariant()) THEN RAISE EXCEPTION 'draft_import_injected_post_rpc_failure'; END IF;
END
`$graph`$;
RESET ROLE;
COMMIT;
"@

$postCommitSql = @"
\set ON_ERROR_STOP on
SELECT 'DRAFT_IMPORT_POST_COMMIT|' || json_build_object(
  'slug', p.slug,
  'public_status', p.public_status,
  'buildings', (SELECT count(*) FROM public.buildings WHERE project_id = p.id),
  'units', (SELECT count(*) FROM public.units WHERE project_id = p.id),
  'prices', (SELECT count(*) FROM public.unit_price_history ph JOIN public.units u ON u.id = ph.unit_id WHERE u.project_id = p.id),
  'warnings', (SELECT count(*) FROM public.ingestion_warnings WHERE project_id = p.id),
  'batches', (SELECT count(*) FROM public.ingestion_batches WHERE project_id = p.id)
)::text FROM public.projects p WHERE p.slug = $slugLiteral AND p.public_status = 'draft';
"@

$plainPassword = ConvertFrom-SecureString $Password
try {
  Invoke-Psql $transactionSql $plainPassword | Out-Null
  $postCommit = Invoke-Psql $postCommitSql $plainPassword
} finally {
  $plainPassword = $null
}

$marker = @($postCommit.Stdout -split "`r?`n" | Where-Object { $_.StartsWith('DRAFT_IMPORT_POST_COMMIT|') })
if ($marker.Count -ne 1) { throw 'Post-commit draft verification did not return exactly one project.' }
Write-Output "IMPORTED AS DRAFT|$slug|$($marker[0].Substring('DRAFT_IMPORT_POST_COMMIT|'.Length))"
