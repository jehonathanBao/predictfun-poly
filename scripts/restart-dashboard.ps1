$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "stop-dashboard.ps1")
Start-Sleep -Seconds 2
& (Join-Path $PSScriptRoot "start-dashboard-full.ps1")
