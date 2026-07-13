[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $TaskFile,
  [ValidateSet('validate-only', 'create-pr', 'full-safe-cycle', 'resume', 'cleanup', 'dry-run')]
  [string] $Mode = 'validate-only',
  [string] $ConfigFile = (Join-Path $PSScriptRoot '..\..\.forever-factory\operator.config.json')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ForeverOperator.psm1') -Force
$result = Invoke-ForeverOperator -TaskFile $TaskFile -Mode $Mode -ConfigFile $ConfigFile
$result | Format-List | Out-Host
if ($result.FinalStatus -notin @('validated', 'dry-run-complete', 'pr-created', 'merged', 'cleaned')) { exit 1 }
