[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$importer = Join-Path $PSScriptRoot 'Import-ForeverProjectDraft.ps1'

Write-Host 'Forever draft project import' -ForegroundColor Cyan
Write-Host 'Leave the project key blank to select a payload file.'
$project = Read-Host 'Project key'
if ([string]::IsNullOrWhiteSpace($project)) {
  $payloadPath = Read-Host 'Payload path'
  $selection = @{ PayloadPath = $payloadPath }
} else {
  $selection = @{ Project = $project }
}

$hostName = $env:FOREVER_IMPORT_HOST
$database = if ($env:FOREVER_IMPORT_DATABASE) { $env:FOREVER_IMPORT_DATABASE } else { 'postgres' }
$userName = if ($env:FOREVER_IMPORT_USER) { $env:FOREVER_IMPORT_USER } else { 'postgres' }
$sslRootCert = $env:FOREVER_IMPORT_SSLROOTCERT
$port = if ($env:FOREVER_IMPORT_PORT) { [int]$env:FOREVER_IMPORT_PORT } else { 5432 }
if ([string]::IsNullOrWhiteSpace($hostName) -or [string]::IsNullOrWhiteSpace($sslRootCert)) {
  throw 'Set FOREVER_IMPORT_HOST and FOREVER_IMPORT_SSLROOTCERT before importing. The launcher never stores credentials.'
}

$password = Read-Host 'Database password' -AsSecureString
& $importer @selection -HostName $hostName -Port $port -Database $database -UserName $userName -SslRootCert $sslRootCert -Password $password
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
