[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Rollback', 'Commit')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$payloadPath = Join-Path $repoRoot 'forever-data\projects\coralina\progressive\payload.json'
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20260718113000_progressive_ingestion_v1.sql'
$templatePath = Join-Path $PSScriptRoot 'coralina-progressive-session.template.sql'
$expectedPayloadHash = '2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605'
$expectedFingerprint = '9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c'
$expectedMigrationHash = '579234319127c36fa2a203b26d81bdfd86c8d01e8c001e45aa96f9d511632b56'

if ((Get-FileHash -Algorithm SHA256 -LiteralPath $payloadPath).Hash.ToLowerInvariant() -cne $expectedPayloadHash) {
  throw 'Exact merged Coralina payload SHA-256 mismatch.'
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $migrationPath).Hash.ToLowerInvariant() -cne $expectedMigrationHash) {
  throw 'Progressive migration SHA-256 mismatch.'
}

$payloadText = [IO.File]::ReadAllText($payloadPath, [Text.UTF8Encoding]::new($false))
if ($payloadText.Contains('$coralina_payload$')) {
  throw 'Payload conflicts with the fixed SQL dollar-quote delimiter.'
}
$payload = $payloadText | ConvertFrom-Json
if ($payload.batch_fingerprint -cne $expectedFingerprint -or
    @($payload.buildings).Count -ne 8 -or @($payload.units).Count -ne 198 -or
    @($payload.prices).Count -ne 198 -or @($payload.warnings).Count -ne 6) {
  throw 'Coralina payload fingerprint or graph cardinality mismatch.'
}
if ($payload.project.slug -cne 'coralina' -or $payload.project.publish -ne $false -or
    $null -ne $payload.project.developer_id -or $null -ne $payload.project.location_id) {
  throw 'Coralina payload identity, draft intent, or canonical-link gate failed.'
}

$postTransaction = if ($Mode -eq 'Rollback') {
@'
SET ROLE service_role;
DO $zero_residue$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE slug = 'coralina')
     OR EXISTS (SELECT 1 FROM public.ingestion_batches WHERE batch_fingerprint = '9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c') THEN
    RAISE EXCEPTION 'rollback_residue_detected';
  END IF;
END
$zero_residue$;
RESET ROLE;
\echo CORALINA_ZERO_RESIDUE_CONFIRMED
'@
} else {
@'
SET ROLE service_role;
DO $post_commit$
DECLARE
  project_uuid uuid;
  replay jsonb;
BEGIN
  SELECT id INTO STRICT project_uuid FROM public.projects WHERE slug = 'coralina';
  IF (SELECT count(*) FROM public.buildings WHERE project_id = project_uuid) <> 8
     OR (SELECT count(*) FROM public.units WHERE project_id = project_uuid) <> 198
     OR (SELECT count(*) FROM public.unit_price_history ph JOIN public.units u ON u.id = ph.unit_id WHERE u.project_id = project_uuid) <> 198
     OR (SELECT count(*) FROM public.ingestion_batches WHERE project_id = project_uuid AND batch_fingerprint = '9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c') <> 1 THEN
    RAISE EXCEPTION 'post_commit_graph_mismatch';
  END IF;
  SELECT public.forever_progressive_ingest(payload) INTO replay FROM pg_temp.coralina_exact_payload;
  IF COALESCE((replay->>'replayed')::boolean, false) IS NOT true THEN
    RAISE EXCEPTION 'post_commit_duplicate_not_safely_replayed';
  END IF;
END
$post_commit$;
RESET ROLE;
\echo CORALINA_COMMIT_AND_DUPLICATE_SAFETY_CONFIRMED
'@
}

$template = [IO.File]::ReadAllText($templatePath, [Text.UTF8Encoding]::new($false))
$generated = $template.Replace('__CORALINA_EXACT_PAYLOAD__', $payloadText).
  Replace('__TRANSACTION_END__', $(if ($Mode -eq 'Rollback') { 'ROLLBACK;' } else { 'COMMIT;' })).
  Replace('__POST_TRANSACTION_CHECK__', $postTransaction.Trim())

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [IO.Path]::GetDirectoryName($resolvedOutput)
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
  [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}
[IO.File]::WriteAllText($resolvedOutput, $generated, [Text.UTF8Encoding]::new($false))
Write-Output "CORALINA_$($Mode.ToUpperInvariant())_SESSION_GENERATED|$resolvedOutput"
