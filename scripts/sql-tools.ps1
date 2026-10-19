<#
  WorkDone server helper actions that need administrator rights.
  Invoked (elevated, via a Windows UAC prompt) by the setup wizard; can also be run manually
  from an elevated PowerShell, e.g.:

    .\sql-tools.ps1 -Action EnableTcp -InstanceId MSSQL16.SQL2022 -ServiceName 'MSSQL$SQL2022' -NamedInstance
    .\sql-tools.ps1 -Action Firewall -Port 3000
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'EnableTcp', 'StartService', 'EnableMixedMode', 'Firewall', 'Autostart', 'RemoveAutostart')]
  [string]$Action,
  # Used by -Action Prepare: which settings to fix in one go (single restart, single UAC prompt)
  [switch]$FixTcp,
  [switch]$FixMixed,
  [ValidatePattern('^MSSQL[\d_]+\.[A-Za-z0-9_$]+$')][string]$InstanceId,
  [ValidatePattern('^(MSSQLSERVER|MSSQL\$[A-Za-z0-9_]+)$')][string]$ServiceName,
  [switch]$NamedInstance,
  [ValidateRange(1, 65535)][int]$Port = 3000,
  [string]$NodePath,
  [string]$ServerScript,
  [string]$WorkDir,
  [string]$ResultFile
)

$ErrorActionPreference = 'Stop'
$SqlRoot = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server'
$TaskName = 'WorkDone Server'
$RuleName = 'WorkDone'

function Write-Result([string]$Message) {
  if ($ResultFile) { Set-Content -Path $ResultFile -Value $Message -Encoding UTF8 }
  Write-Output $Message
}

function Restart-Sql {
  Set-Service -Name $ServiceName -StartupType Automatic
  if ((Get-Service -Name $ServiceName).Status -eq 'Running') {
    Restart-Service -Name $ServiceName -Force
  } else {
    Start-Service -Name $ServiceName
  }
  (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
}

function Start-BrowserService {
  # Named instances are located through the SQL Server Browser service
  if ($NamedInstance) {
    Set-Service -Name 'SQLBrowser' -StartupType Automatic
    if ((Get-Service -Name 'SQLBrowser').Status -ne 'Running') { Start-Service -Name 'SQLBrowser' }
  }
}

function Assert-Instance {
  if (-not $InstanceId -or -not $ServiceName) { throw 'InstanceId and ServiceName are required.' }
  if (-not (Test-Path "$SqlRoot\$InstanceId")) { throw "SQL Server instance $InstanceId not found." }
}

try {
  switch ($Action) {
    'Prepare' {
      Assert-Instance
      $done = @()
      if ($FixTcp) {
        Set-ItemProperty -Path "$SqlRoot\$InstanceId\MSSQLServer\SuperSocketNetLib\Tcp" -Name Enabled -Value 1
        $done += 'TCP/IP enabled'
      }
      if ($FixMixed) {
        Set-ItemProperty -Path "$SqlRoot\$InstanceId\MSSQLServer" -Name LoginMode -Value 2
        $done += 'SQL logins enabled'
      }
      Start-BrowserService
      Restart-Sql
      $done += "$ServiceName running (startup: Automatic)"
      Write-Result ($done -join '; ')
    }
    'EnableTcp' {
      Assert-Instance
      Set-ItemProperty -Path "$SqlRoot\$InstanceId\MSSQLServer\SuperSocketNetLib\Tcp" -Name Enabled -Value 1
      Start-BrowserService
      Restart-Sql
      Write-Result "TCP/IP enabled and $ServiceName restarted."
    }
    'StartService' {
      Assert-Instance
      Start-BrowserService
      Set-Service -Name $ServiceName -StartupType Automatic
      Start-Service -Name $ServiceName
      (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
      Write-Result "$ServiceName started (startup type: Automatic)."
    }
    'EnableMixedMode' {
      Assert-Instance
      # 2 = SQL Server and Windows Authentication mode
      Set-ItemProperty -Path "$SqlRoot\$InstanceId\MSSQLServer" -Name LoginMode -Value 2
      Restart-Sql
      Write-Result "Mixed authentication enabled and $ServiceName restarted."
    }
    'Firewall' {
      Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
      # Only computers on the local subnet (the office LAN) may connect
      New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port `
        -RemoteAddress LocalSubnet -Profile Domain, Private -Action Allow | Out-Null
      Write-Result "Firewall rule '$RuleName' allows TCP $Port from the local network (Domain/Private profiles)."
    }
    'Autostart' {
      if (-not (Test-Path $NodePath)) { throw "Node.js not found at $NodePath" }
      if (-not (Test-Path $ServerScript)) { throw "Server script not found at $ServerScript" }
      $taskAction = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ServerScript`"" -WorkingDirectory $WorkDir
      $trigger = New-ScheduledTaskTrigger -AtStartup
      $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
      $settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
      Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Principal $principal `
        -Settings $settings -Description 'Starts the Q-WorkDone server at boot' -Force | Out-Null
      Write-Result "Q-WorkDone will start automatically when Windows starts (scheduled task '$TaskName')."
    }
    'RemoveAutostart' {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
      Write-Result "Auto-start removed."
    }
  }
  exit 0
} catch {
  Write-Result "Error: $($_.Exception.Message)"
  exit 1
}
