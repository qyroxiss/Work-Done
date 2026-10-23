<#
  Starts (or stops) the private PostgreSQL server used for local development on port 5433.
  Its data lives in %LOCALAPPDATA%\WorkDone\pgdata (created with initdb, user "workdone");
  it is separate from any PostgreSQL service installed on this computer.

    .\dev-postgres.ps1           # start (does nothing if it is already running)
    .\dev-postgres.ps1 -Stop
#>
param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$pgCtl = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_ctl.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $pgCtl) { throw 'PostgreSQL is not installed (C:\Program Files\PostgreSQL\<version>\bin not found).' }

$root = Join-Path $env:LOCALAPPDATA 'WorkDone'
$data = Join-Path $root 'pgdata'
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) { throw "No development database found at $data." }

if ($Stop) {
  & $pgCtl.FullName -D $data stop -m fast
  return
}

& $pgCtl.FullName -D $data status *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Output 'Development PostgreSQL is already running on port 5433.'
  return
}
# Started detached so this window can close; logs go to %LOCALAPPDATA%\WorkDone\postgres.log
Start-Process -FilePath $pgCtl.FullName -WindowStyle Hidden -ArgumentList @(
  '-D', "`"$data`"", '-l', "`"$(Join-Path $root 'postgres.log')`"", '-o', '"-p 5433 -c listen_addresses=localhost"', 'start'
)
Start-Sleep -Seconds 3
Write-Output 'Development PostgreSQL started on port 5433.'
