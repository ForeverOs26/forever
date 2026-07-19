# Forever Partner Demo v1 — local presentation launcher.
#
# Starts the existing local development server for the partner presentation.
# Local machine only: no production credentials are read or printed, no
# database client is created, no import runs, and nothing is published.
# The full presentation script lives in docs/PARTNER_DEMO_V1.md.

[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 5173,
    [ValidateRange(5, 300)]
    [int]$StartupTimeoutSeconds = 60,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

Write-Host ''
Write-Host '  Forever Partner Demo v1' -ForegroundColor White
Write-Host '  -----------------------' -ForegroundColor DarkGray

if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    Write-Host '  Could not find package.json — run this from the Forever repository.' -ForegroundColor Red
    exit 1
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
if (-not $node) {
    Write-Host '  Node.js was not found on this machine.' -ForegroundColor Red
    Write-Host '  Install Node.js LTS, then run this launcher again.'
    exit 1
}
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) {
    Write-Host '  npm was not found on this machine.' -ForegroundColor Red
    Write-Host '  Repair the Node.js installation, then run this launcher again.'
    exit 1
}
$nodeVersion = (& $node.Source --version) 2>$null
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

try {
    $listener = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Loopback,
        $Port
    )
    $listener.Start()
    $listener.Stop()
}
catch {
    Write-Host ''
    Write-Host "  Port $Port is already in use." -ForegroundColor Red
    Write-Host '  Close the other local server, then run the Partner Demo again.'
    exit 1
}

$mutex = [System.Threading.Mutex]::new($false, 'Local\ForeverPartnerDemoV1')
$ownsMutex = $false
try {
    $ownsMutex = $mutex.WaitOne(0, $false)
}
catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
}
if (-not $ownsMutex) {
    Write-Host ''
    Write-Host '  Another Forever Partner Demo launcher is already running.' -ForegroundColor Red
    Write-Host '  Use the existing demo window or close it before starting again.'
    $mutex.Dispose()
    exit 1
}

$demoUrl = "http://localhost:$Port/"
$healthUrl = "http://127.0.0.1:$Port/__forever_partner_demo_health"

# Process-scoped values override shell variables and every Vite .env file.
# Safe local placeholders prevent inherited production Supabase settings from
# entering the presentation process; the committed-data adapter performs no
# Supabase request and the lead boundary performs no write request.
$env:VITE_PARTNER_DEMO = 'true'
$env:VITE_PARTNER_DEMO_DATA = 'committed-local'
$env:VITE_DEMO_LEAD_MODE = 'true'
$env:VITE_ENABLE_DEMO_PREVIEW = 'true'
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:1'
$env:SUPABASE_URL = 'http://127.0.0.1:1'
$env:VITE_SUPABASE_PROJECT_ID = 'partner-demo-local-only'
$env:SUPABASE_PROJECT_ID = 'partner-demo-local-only'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'partner-demo-no-write-key'
$env:SUPABASE_PUBLISHABLE_KEY = 'partner-demo-no-write-key'

# Some desktop hosts pass both `Path` and `PATH`. Windows PowerShell's
# Start-Process rejects that duplicate environment key. Normalize it without
# losing either host-provided search path before the child server starts.
$combinedPath = @($env:Path, $env:PATH) -join ';'
Remove-Item Env:Path -ErrorAction SilentlyContinue
Remove-Item Env:PATH -ErrorAction SilentlyContinue
$env:Path = ($combinedPath -split ';' | Where-Object { $_ } | Select-Object -Unique) -join ';'

Write-Host ''
Write-Host '  Safety controls set for this launcher process:' -ForegroundColor Green
Write-Host '    - committed local project data only'
Write-Host '    - advisory forms validate but cannot write a lead'
Write-Host '    - inherited production settings are replaced with local placeholders'
Write-Host ''
Write-Host '  Presentation routes:' -ForegroundColor White
Write-Host "    1. $demoUrl                    Home"
Write-Host "    2. ${demoUrl}navigator           Forever Navigator"
Write-Host "    3. ${demoUrl}projects            Project catalogue"
Write-Host "    4. ${demoUrl}projects/modeva     Published project (Modeva)"
Write-Host "    5. ${demoUrl}projects/coralina   Coralina unpublished preview"
Write-Host "    6. ${demoUrl}booth               Booth Mode (staff)"
Write-Host ''
Write-Host '  To stop the demo: press Ctrl+C in this window, then close it.' -ForegroundColor White
Write-Host ''

Write-Host '  Starting the Forever development server...' -ForegroundColor DarkGray
Write-Host ''

$server = $null
try {
    $server = Start-Process -FilePath $npm.Source -ArgumentList @(
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--mode',
        'partner-demo',
        '--port',
        [string]$Port,
        '--strictPort'
    ) -NoNewWindow -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($server.HasExited) {
            throw "The Forever server stopped during startup (exit code $($server.ExitCode))."
        }

        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1
            $health = $response.Content | ConvertFrom-Json
            $ready =
                $response.StatusCode -eq 200 -and
                $health.app -eq 'forever' -and
                $health.mode -eq 'partner-demo' -and
                $health.safe -eq $true -and
                $health.leadWrites -eq 'blocked' -and
                $health.projectData -eq 'committed-local'
            if ($ready) { break }
        }
        catch {
            # The server is still starting. Retry until the bounded deadline.
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $ready) {
        throw "The Partner Demo did not prove safe readiness within $StartupTimeoutSeconds seconds."
    }

    Write-Host '  Safe readiness confirmed: local data and no-write lead mode.' -ForegroundColor Green
    if (-not $NoBrowser) {
        Start-Process $demoUrl
    }
    Write-Host "  Ready at $demoUrl" -ForegroundColor White
    Write-Host ''

    Wait-Process -Id $server.Id
    if ($server.ExitCode -ne 0) {
        throw "The Forever server stopped with exit code $($server.ExitCode)."
    }
}
catch {
    Write-Host ''
    Write-Host "  Partner Demo could not start safely: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        $server.WaitForExit()
    }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
