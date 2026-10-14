<#
.SYNOPSIS
Synthetic hosted-runner installation/import comparison. NOT CUSTOMER-READY.
.DESCRIPTION
No Azure authentication or customer input. The external supervisor owns limits.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$results = $env:LAB_RESULTS
$script:phase = 'Preparation'

function Send-Record {
    param([string]$Stream, [string]$Message)
    [ordered]@{ Utc = [DateTime]::UtcNow.ToString('o'); Phase = $script:phase; Stream = $Stream; Message = $Message } |
        ConvertTo-Json -Compress -Depth 6 | Write-Output
}

function Send-CommandOutput {
    param($Record)
    $stream = switch ($Record) {
        { $_ -is [Management.Automation.DebugRecord] } { 'Debug'; break }
        { $_ -is [Management.Automation.VerboseRecord] } { 'Verbose'; break }
        { $_ -is [Management.Automation.WarningRecord] } { 'Warning'; break }
        { $_ -is [Management.Automation.ErrorRecord] } { 'Error'; break }
        { $_ -is [Management.Automation.InformationRecord] } { 'Information'; break }
        default { 'Output' }
    }
    Send-Record -Stream $stream -Message ($Record | Out-String -Width 240).TrimEnd()
}

$diagnostics = $env:ENABLE_DIAGNOSTICS -eq 'true'
$flags = @{}
if ($diagnostics) { $flags = @{ Debug = $true; Verbose = $true } }
$modules = Join-Path $env:HOME '.local/share/powershell/Modules'
[void][IO.Directory]::CreateDirectory($modules)
$env:PSModulePath = $modules + [IO.Path]::PathSeparator + (Join-Path $PSHOME 'Modules')
$record = [ordered]@{
    StartUtc = [DateTime]::UtcNow.ToString('o')
    EndUtc = $null
    RequestedImage = $env:REQUESTED_IMAGE
    ImageOS = $env:ImageOS
    ImageVersion = $env:ImageVersion
    Os = $PSVersionTable.OS
    Architecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    PowerShell = $PSVersionTable.PSVersion.ToString()
    Manager = $env:PACKAGE_MANAGER
    AzVersion = $env:AZ_VERSION
    DebugEnabled = $diagnostics
    RunnerEnvironment = $env:RUNNER_ENVIRONMENT
    RegionSelection = 'Standard GitHub-hosted placement; region not selected'
    PackageManagers = @(Get-Module -ListAvailable PowerShellGet, PackageManagement, Microsoft.PowerShell.PSResourceGet |
        Select-Object Name, @{ Name = 'Version'; Expression = { $_.Version.ToString() } })
    Phases = [ordered]@{}
    InstalledModules = @()
    ImportedModules = @()
    Succeeded = $false
    Error = $null
}

try {
    if ($record.PowerShell -ne '7.6.6') { throw 'Runtime pin mismatch' }
    if ($env:AZ_VERSION -ne '16.4.0') { throw 'Az pin mismatch' }
    if ($env:PACKAGE_MANAGER -notin @('PowerShellGet', 'PSResourceGet')) { throw 'Unexpected package manager' }
    $installCommand = if ($env:PACKAGE_MANAGER -eq 'PowerShellGet') { 'Install-Module' } else { 'Install-PSResource' }
    foreach ($commandName in @($installCommand, 'Import-Module')) {
        $metadata = Get-Command $commandName -ErrorAction Stop
        if (-not $metadata.Parameters.ContainsKey('Debug') -or -not $metadata.Parameters.ContainsKey('Verbose')) {
            throw "Diagnostic switches unsupported by $commandName"
        }
    }
    if ($env:PACKAGE_MANAGER -eq 'PowerShellGet') { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted }
    Send-Record -Stream 'Metadata' -Message ($record | ConvertTo-Json -Compress -Depth 8)
    foreach ($phaseName in @('Install', 'Import')) {
        $script:phase = $phaseName
        $phaseRecord = [ordered]@{
            StartUtc = [DateTime]::UtcNow.ToString('o')
            EndUtc = $null
            Seconds = $null
            Succeeded = $false
            Command = $null
        }
        $clock = [Diagnostics.Stopwatch]::StartNew()
        Send-Record -Stream 'PhaseStart' -Message $phaseName
        try {
            $suffix = if ($diagnostics) { ' -Debug -Verbose' } else { '' }
            if ($phaseName -eq 'Import') {
                $phaseRecord.Command = "Import-Module -Name Az -RequiredVersion $env:AZ_VERSION -Force -ErrorAction Stop$suffix"
                Send-Record -Stream 'Command' -Message $phaseRecord.Command
                Import-Module -Name Az -RequiredVersion $env:AZ_VERSION -Force -ErrorAction Stop @flags *>&1 |
                    ForEach-Object { Send-CommandOutput $_ }
            } elseif ($env:PACKAGE_MANAGER -eq 'PowerShellGet') {
                $phaseRecord.Command = "Install-Module -Name Az -RequiredVersion $env:AZ_VERSION -Repository PSGallery -AllowClobber -Scope CurrentUser -Force -ErrorAction Stop$suffix"
                Send-Record -Stream 'Command' -Message $phaseRecord.Command
                Install-Module -Name Az -RequiredVersion $env:AZ_VERSION -Repository PSGallery -AllowClobber -Scope CurrentUser -Force -ErrorAction Stop @flags *>&1 |
                    ForEach-Object { Send-CommandOutput $_ }
            } else {
                $phaseRecord.Command = "Install-PSResource -Name Az -Version $env:AZ_VERSION -Repository PSGallery -Scope CurrentUser -TrustRepository -Reinstall -ErrorAction Stop$suffix"
                Send-Record -Stream 'Command' -Message $phaseRecord.Command
                Install-PSResource -Name Az -Version $env:AZ_VERSION -Repository PSGallery -Scope CurrentUser -TrustRepository -Reinstall -ErrorAction Stop @flags *>&1 |
                    ForEach-Object { Send-CommandOutput $_ }
            }
            $phaseRecord.Succeeded = $true
        } finally {
            $clock.Stop()
            $phaseRecord.Seconds = $clock.Elapsed.TotalSeconds
            $phaseRecord.EndUtc = [DateTime]::UtcNow.ToString('o')
            $record.Phases[$phaseName] = $phaseRecord
            Send-Record -Stream 'PhaseEnd' -Message ($phaseRecord | ConvertTo-Json -Compress)
            $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $results 'summary.json') -Encoding utf8
        }
    }
    $script:phase = 'Inventory'
    $record.InstalledModules = @(Get-Module -ListAvailable -Name Az, 'Az.*' | Sort-Object Name, Version |
        Select-Object Name, @{ Name = 'Version'; Expression = { $_.Version.ToString() } })
    $record.ImportedModules = @(Get-Module -Name Az, 'Az.*' | Sort-Object Name, Version |
        Select-Object Name, @{ Name = 'Version'; Expression = { $_.Version.ToString() } })
    if (-not ($record.ImportedModules | Where-Object { $_.Name -eq 'Az' -and $_.Version -eq $env:AZ_VERSION })) {
        throw 'Pinned Az not imported after command completed'
    }
    $record.Succeeded = $true
} catch {
    $record.Error = [ordered]@{
        Message = $_.ToString()
        FullyQualifiedErrorId = $_.FullyQualifiedErrorId
        Exception = $_.Exception.ToString()
        ScriptStackTrace = $_.ScriptStackTrace
        Position = $_.InvocationInfo.PositionMessage
    }
    Send-Record -Stream 'Error' -Message ($record.Error | ConvertTo-Json -Compress -Depth 5)
} finally {
    $record.EndUtc = [DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $results 'summary.json') -Encoding utf8
    Send-Record -Stream 'Summary' -Message ($record | ConvertTo-Json -Compress -Depth 10)
}
if (-not $record.Succeeded) { exit 1 }