# Forever Partner Demo v1 — local presentation launcher.
#
# Starts the existing local development server for the partner presentation.
# Local machine only: no production credentials are read or printed, no
# database client is created, no import runs, and nothing is published.
# The full presentation script lives in docs/PARTNER_DEMO_V1.md.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

Write-Host ''
Write-Host '  Forever Partner Demo v1' -ForegroundColor White
Write-Host '  -----------------------' -ForegroundColor DarkGray

if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    Write-Host '  Could not find package.json — run this from the Forever repository.' -ForegroundColor Red
    exit 1
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) {
    Write-Host '  Node.js / npm was not found on this machine.' -ForegroundColor Red
    Write-Host '  Install Node.js LTS from https://nodejs.org and run this launcher again.'
    exit 1
}
$nodeVersion = (& node --version) 2>$null
Write-Host "  Node $nodeVersion detected." -ForegroundColor DarkGray

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Write-Host ''
    Write-Host '  Dependencies are not installed yet.' -ForegroundColor Yellow
    Write-Host '  Run this once in the repository folder, then start the launcher again:'
    Write-Host ''
    Write-Host '      npm install' -ForegroundColor White
    Write-Host ''
    exit 1
}

if (-not (Test-Path (Join-Path $repoRoot '.env'))) {
    Write-Host ''
    Write-Host '  Note: no .env file found.' -ForegroundColor Yellow
    Write-Host '  The Navigator, Booth Mode, and the Coralina preview still work,'
    Write-Host '  but the home page and project catalogue need the usual .env'
    Write-Host '  (see .env.example) to show published projects.'
}

Write-Host ''
Write-Host '  Demo lead mode is ON by default in local development:' -ForegroundColor Green
Write-Host '  lead forms complete normally but nothing is saved anywhere.'
Write-Host ''
Write-Host '  Presentation routes:' -ForegroundColor White
Write-Host '    1. http://localhost:5173/                    Home'
Write-Host '    2. http://localhost:5173/navigator           Forever Navigator'
Write-Host '    3. http://localhost:5173/projects            Project catalogue'
Write-Host '    4. http://localhost:5173/projects/modeva     Published project (Modeva)'
Write-Host '    5. http://localhost:5173/projects/coralina   Coralina draft preview (local only)'
Write-Host '    6. http://localhost:5173/booth               Booth Mode (staff)'
Write-Host ''
Write-Host '  To stop the demo: press Ctrl+C in this window, then close it.' -ForegroundColor White
Write-Host ''

# Open the first presentation route once the dev server has had time to boot.
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 6
    Start-Process 'http://localhost:5173/'
} | Out-Null

Write-Host '  Starting the Forever development server...' -ForegroundColor DarkGray
Write-Host ''

& $npm.Source run dev
