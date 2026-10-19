<#
  WorkDone one-click launcher (used by WorkDone.bat).
  - checks Node.js
  - installs dependencies and builds the app when needed
  - starts the server and opens the browser (setup wizard on first run)

  Options:  -Rebuild   force a fresh build
            -NoBrowser do not open the browser
#>
param([switch]$Rebuild, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Host.UI.RawUI.WindowTitle = 'Q-WorkDone Server'

function Step([string]$Text) { Write-Host "`n>> $Text" -ForegroundColor Cyan }
function Fail([string]$Text) {
  Write-Host "`nERROR: $Text" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

# ---- Port from backend\.env (default 3000) ----
$Port = 3000
$envFile = Join-Path $Backend '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $Port = [int]$line.Matches[0].Groups[1].Value }
}
$Url = "http://localhost:$Port"

function Test-Running {
  # 127.0.0.1 (not localhost): Windows PowerShell may try IPv6 first and time out
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 | Out-Null; return $true }
  catch {
    # Any HTTP answer (e.g. 503 while SQL Server is down) means the server process is up
    return [bool]($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response)
  }
}

function Newest([string]$Path) {
  $f = Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { return $f.LastWriteTime } else { return [datetime]::MinValue }
}

# True when the source code is newer than the last build (or -Rebuild was given)
function Test-BuildOutdated([string]$Dir, [string]$Output, [string[]]$Sources) {
  $outPath = Join-Path $Dir $Output
  $srcTime = ($Sources | ForEach-Object { Newest (Join-Path $Dir $_) } | Sort-Object -Descending | Select-Object -First 1)
  return ($Rebuild -or -not (Test-Path $outPath) -or (Newest $outPath) -lt $srcTime)
}

function Test-AnyBuildOutdated {
  return ((Test-BuildOutdated $Frontend 'dist' @('src', 'index.html')) -or (Test-BuildOutdated $Backend 'dist' @('src')))
}

# ---- Already running (e.g. auto-start)? ----
if (Test-Running) {
  if (-not (Test-AnyBuildOutdated)) {
    Write-Host "Q-WorkDone is already running at $Url"
    if (-not $NoBrowser) { Start-Process $Url }
    exit 0
  }
  # The code was updated: stop the running server so the new version can be built and started
  Step 'Stopping the running server to install the update'
  # The process listening on the port: the command line of a server started by the auto-start
  # task (running as SYSTEM) cannot be read from a normal window, so look it up by port
  $listeners = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess
  foreach ($procId in ($listeners | Sort-Object -Unique)) {
    if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -eq 'node') {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  for ($i = 0; $i -lt 20 -and (Test-Running); $i++) { Start-Sleep -Milliseconds 500 }
  if (Test-Running) {
    Fail "The running server could not be stopped: it was started automatically with administrator rights. Right-click WorkDone.bat and choose 'Run as administrator', or restart this computer."
  }
}

# ---- Node.js ----
Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org and run Q-WorkDone again.' }
$ver = (& node -v).TrimStart('v')
if ([int]($ver.Split('.')[0]) -lt 20) { Fail "Node.js $ver is too old. Install Node.js 20 or newer from https://nodejs.org." }
Write-Host "Node.js $ver"

function Ensure-Deps([string]$Dir, [string]$Name) {
  # Install on first run, and again when package-lock.json changed (new packages after an update)
  $installed = Join-Path $Dir 'node_modules\.package-lock.json'
  $lock = Join-Path $Dir 'package-lock.json'
  if (-not (Test-Path $installed) -or ((Test-Path $lock) -and (Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime)) {
    Step "Installing $Name packages (first run only, needs internet)"
    Push-Location $Dir
    try {
      if (Test-Path 'package-lock.json') { & npm ci --no-audit --no-fund } else { & npm install --no-audit --no-fund }
      if ($LASTEXITCODE -ne 0) { Fail "npm install failed for $Name." }
    } finally { Pop-Location }
  }
}

function Ensure-Build([string]$Dir, [string]$Name, [string]$Output, [string[]]$Sources) {
  if (Test-BuildOutdated $Dir $Output $Sources) {
    Step "Building $Name"
    Push-Location $Dir
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) { Fail "Build failed for $Name." }
    } finally { Pop-Location }
  }
}

Ensure-Deps $Backend 'server'
Ensure-Deps $Frontend 'user interface'
Ensure-Build $Frontend 'user interface' 'dist' @('src', 'index.html')
Ensure-Build $Backend 'server' 'dist' @('src')

# ---- Start ----
Step "Starting Q-WorkDone on $Url"
Write-Host 'Keep this window open while people use Q-WorkDone. Close it (or press Ctrl+C) to stop the server.' -ForegroundColor Yellow

$proc = Start-Process -FilePath $node.Source -ArgumentList "`"$(Join-Path $Backend 'dist\server.js')`"" `
  -WorkingDirectory $Backend -NoNewWindow -PassThru

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  if ($proc.HasExited) { Fail 'The server stopped unexpectedly. See the messages above.' }
  if (Test-Running) { $ready = $true; break }
}
if ($ready -and -not $NoBrowser) { Start-Process $Url }

$ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress
Write-Host "`nOn this computer : $Url" -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "Other office PCs : http://${ip}:$Port" -ForegroundColor Green }

Wait-Process -Id $proc.Id
