<#
.SYNOPSIS
  Build the Windows installer for Afterlife Lease (NSIS, x64, per-user).

.DESCRIPTION
  Runs the full release pipeline from a clean checkout and fails fast on the first broken step:
    1. tool checks (Node.js >= 22.12, npm >= 10)
    2. npm ci                      (skip with -SkipInstall)
    3. npm run typecheck           (renderer + electron projects)
    4. npm test                    (skip with -SkipTests)
    5. asset verification          (public/assets manifests, SHA-256)
    6. npm run build               (Vite web build into dist/)
    7. asset verification of dist/ (catches a corrupted copy)
    8. npm run electron:build-main (electron/dist + sandbox check)
    9. electron-builder --win nsis --x64
   10. prints the installer path and its SHA-256 (also written to <installer>.sha256)

  Works in Windows PowerShell 5.1 and PowerShell 7+. Run from any directory:
    powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
    pwsh -File scripts/build-windows.ps1 -SkipTests

.PARAMETER SkipInstall
  Use the existing node_modules instead of running npm ci.

.PARAMETER SkipTests
  Skip the vitest suites (not recommended for release builds).
#>
[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$MinNode = [version]'22.12.0'
$MinNpm = [version]'10.0.0'

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  Write-Host ''
  Write-Host "==> $Name" -ForegroundColor Cyan
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  # Native tools (npm, node, electron-builder) print warnings on stderr. When stderr is redirected (CI
  # agents, ISE, 2>&1) Windows PowerShell 5.1 turns every such line into an ErrorRecord, and 'Stop' would
  # abort a healthy build on the first "npm warn". Exit codes decide success instead (local scope only).
  $ErrorActionPreference = 'Continue'
  if (Get-Variable -Name 'PSNativeCommandUseErrorActionPreference' -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
  }
  $global:LASTEXITCODE = 0
  & $Command
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) {
    throw "Step '$Name' failed with exit code $code"
  }
  Write-Host ('    ok ({0:N1}s)' -f $timer.Elapsed.TotalSeconds) -ForegroundColor DarkGray
}

function Remove-DirectoryWithRetry {
  param([Parameter(Mandatory = $true)][string]$Path)
  # Defender / the indexer / a still-running old installer briefly lock files on Windows.
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    }
    catch {
      if ($attempt -eq 6) {
        throw "Could not delete $Path (a file is locked - close the old installer or pause antivirus scanning): $($_.Exception.Message)"
      }
      Start-Sleep -Milliseconds (300 * $attempt)
    }
  }
}

function Get-ToolVersion {
  param([Parameter(Mandatory = $true)][string]$Tool)
  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
    throw "$Tool was not found on PATH. Install Node.js $MinNode or newer (https://nodejs.org) and reopen the terminal."
  }
  $raw = (& $Tool --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "'$Tool --version' failed" }
  $clean = $raw.TrimStart('v') -replace '[^0-9.].*$', ''
  return [version]$clean
}

Push-Location -LiteralPath $RepoRoot
try {
  Write-Host "Afterlife Lease - Windows release build" -ForegroundColor Green
  Write-Host "Repository: $RepoRoot"
  Write-Host ("PowerShell {0} on {1}" -f $PSVersionTable.PSVersion, [System.Environment]::OSVersion.VersionString)

  $nodeVersion = Get-ToolVersion -Tool 'node'
  $npmVersion = Get-ToolVersion -Tool 'npm'
  Write-Host "node $nodeVersion, npm $npmVersion"
  if ($nodeVersion -lt $MinNode) { throw "Node.js $nodeVersion is too old; Afterlife Lease needs $MinNode or newer." }
  if ($npmVersion -lt $MinNpm) { throw "npm $npmVersion is too old; need $MinNpm or newer (npm install -g npm@10)." }

  $package = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
  $version = [string]$package.version
  if (-not $version) { throw 'package.json has no version' }

  if (-not $SkipInstall) {
    # The electron binary IS needed on a build machine (electron-builder also fetches the win32 zip).
    Remove-Item Env:\ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
    Invoke-Step -Name 'npm ci' -Command { npm ci --no-audit --no-fund }
  }
  Invoke-Step -Name 'typecheck' -Command { npm run typecheck }
  if (-not $SkipTests) {
    Invoke-Step -Name 'tests' -Command { npm test }
  }
  Invoke-Step -Name 'verify source assets' -Command { node scripts/verify-assets.mjs }
  Invoke-Step -Name 'web build (vite)' -Command { npm run build }
  Invoke-Step -Name 'verify built assets' -Command { node scripts/verify-assets.mjs --root dist/assets }
  Invoke-Step -Name 'electron main + preload' -Command { npm run electron:build-main }

  $releaseDir = Join-Path $RepoRoot (Join-Path 'release' $version)
  Remove-DirectoryWithRetry -Path $releaseDir
  Invoke-Step -Name 'electron-builder (NSIS x64)' -Command {
    node node_modules/electron-builder/cli.js --win nsis --x64 --config electron/electron-builder.json --publish never
  }

  $installers = @(Get-ChildItem -LiteralPath $releaseDir -Filter '*.exe' -File | Sort-Object -Property LastWriteTime -Descending)
  if ($installers.Count -eq 0) { throw "electron-builder reported success but no installer was found in $releaseDir" }

  Write-Host ''
  foreach ($installer in $installers) {
    $hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
    $line = '{0}  {1}' -f $hash.Hash.ToLowerInvariant(), $installer.Name
    Set-Content -LiteralPath ($installer.FullName + '.sha256') -Value $line -Encoding Ascii
    Write-Host ('Installer : {0}' -f $installer.FullName) -ForegroundColor Green
    Write-Host ('Size      : {0:N1} MB' -f ($installer.Length / 1MB))
    Write-Host ('SHA-256   : {0}' -f $hash.Hash.ToLowerInvariant())
  }
  Write-Host ''
  Write-Host 'Note: the installer is unsigned unless CSC_LINK/CSC_KEY_PASSWORD were set; SmartScreen will warn on first run.' -ForegroundColor Yellow
}
catch {
  Write-Host ''
  Write-Host ("BUILD FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
  exit 1
}
finally {
  Pop-Location
}
