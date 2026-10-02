#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$distro = 'Ubuntu'
$linuxUser = 'imran'
$scriptPath = "/home/$linuxUser/bin/pull-dueling-backup.sh"
$time = '21:00'
$taskName = 'Dueling System backup pull'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
    -Execute "$env:SystemRoot\System32\wsl.exe" `
    -Argument ('-d "{0}" -u "{1}" -- "{2}"' -f $distro, $linuxUser, $scriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

# -Force replaces this user's existing task; Interactive never stores a password.
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Registered '$taskName' for $currentUser, daily at $time local time."

# Run once: Start-ScheduledTask -TaskName $taskName
# Remove: Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
