<#
.SYNOPSIS
  Run Afterlife Lease in Electron against the Vite dev server (hot reload).

.DESCRIPTION
  Checks the toolchain, makes sure the Electron binary was downloaded, then hands off to the
  cross-platform runner scripts/dev-electron.mjs, which compiles electron/, starts (or reuses) the
  Vite dev server, launches Electron with ELECTRON_RENDERER_URL and stops Vite when Electron exits.
  Saves made in dev go to the same folder as the installed game: %APPDATA%\Afterlife Lease\saves.

    powershell -ExecutionPolicy Bypass -File scripts\dev-electron.ps1
    pwsh -File scripts/dev-electron.ps1 -Port 5180

.PARAMETER Port
  Dev server port (default 5173, the game's Vite port).
#>
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$Port = 5173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $RepoRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js was not found on PATH. Install Node.js 22.12 or newer.'
  }
  $nodeVersion = [version]((& node --version | Out-String).Trim().TrimStart('v'))
  if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js $nodeVersion is too old; need 22.12.0 or newer." }

  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules'))) {
    Write-Host '==> npm install (first run)' -ForegroundColor Cyan
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  }
  $pathFile = Join-Path $RepoRoot 'node_modules\electron\path.txt'
  if (-not (Test-Path -LiteralPath $pathFile)) {
    Write-Host '==> downloading the Electron binary' -ForegroundColor Cyan
    Remove-Item Env:\ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
    node node_modules/electron/install.js
    if ($LASTEXITCODE -ne 0) { throw 'Electron binary download failed (proxy/firewall?). See docs/PLATFORM.md.' }
  }

  & node scripts/dev-electron.mjs --port $Port
  exit $LASTEXITCODE
}
catch {
  Write-Host ("dev-electron failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
  exit 1
}
finally {
  Pop-Location
}
