<#
  Q-WorkDone server options that need administrator rights.
  Invoked (elevated, via a Windows UAC prompt) by the setup wizard; can also be run manually
  from an elevated PowerShell, e.g.:

    .\server-tools.ps1 -Action Firewall -Port 3000
    .\server-tools.ps1 -Action RemoveAutostart
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Firewall', 'Autostart', 'RemoveAutostart')]
  [string]$Action,
  [ValidateRange(1, 65535)][int]$Port = 3000,
  [string]$NodePath,
  [string]$ServerScript,
  [string]$WorkDir,
  [string]$ResultFile
)

$ErrorActionPreference = 'Stop'
$TaskName = 'WorkDone Server'
$RuleName = 'WorkDone'

function Write-Result([string]$Message) {
  if ($ResultFile) { Set-Content -Path $ResultFile -Value $Message -Encoding UTF8 }
  Write-Output $Message
}

try {
  switch ($Action) {
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
