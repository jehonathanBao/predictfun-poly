$ErrorActionPreference = "Stop"

function Resolve-ProjectPath {
  param(
    [string]$ConfiguredPath,
    [Parameter(Mandatory = $true)][string]$FallbackPath
  )

  if ([string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    return $FallbackPath
  }
  if ([System.IO.Path]::IsPathRooted($ConfiguredPath)) {
    return $ConfiguredPath
  }
  return Join-Path $ProjectRoot $ConfiguredPath
}

function Escape-SingleQuotedLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return $Value.Replace("'", "''")
}

function Write-LauncherLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = "{0} {1}" -f (Get-Date).ToString("s"), $Message
  Add-Content -LiteralPath $LauncherLog -Value $line -Encoding UTF8
  Write-Host $Message
}

function Import-PaperEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf("=")
    if ($separatorIndex -le 0) {
      continue
    }

    $name = $trimmed.Substring(0, $separatorIndex).Trim()
    if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
      continue
    }

    if ([Environment]::GetEnvironmentVariable($name, "Process")) {
      continue
    }

    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }

  Write-LauncherLog "Loaded paper environment defaults from $Path"
}

function Set-DefaultEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Get-UrlHost {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return "-"
  }
  try {
    return ([System.Uri]$Value).Host
  } catch {
    return "custom"
  }
}

function Mask-TokenForLog {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return "-"
  }
  $normalized = $Value.Trim()
  if ($normalized.Length -le 12) {
    return $normalized
  }
  return "{0}...{1}" -f $normalized.Substring(0, 6), $normalized.Substring($normalized.Length - 4)
}

function Initialize-PaperDefaults {
  $paperEnvPath = Join-Path $ProjectRoot ".env.paper.local"
  Import-PaperEnvFile -Path $paperEnvPath

  Set-DefaultEnv -Name "PAPER_LIVE_MARKET_DATA" -Value "true"
  Set-DefaultEnv -Name "PAPER_SIMULATE_WALLETS" -Value "true"
  Set-DefaultEnv -Name "PAPER_SIM_PREDICT_WALLET_COUNT" -Value "10"
  Set-DefaultEnv -Name "PAPER_SIM_PREDICT_WALLET_FUNDS_USD" -Value "100"
  Set-DefaultEnv -Name "PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD" -Value "100"
  Set-DefaultEnv -Name "PAPER_SIM_NET_EXPOSURE_USD" -Value "20"
  Set-DefaultEnv -Name "DRY_RUN_WORKER_INTERVAL_MS" -Value "5000"

  $marketDataStatus = "missing token/url"
  if (-not [string]::IsNullOrWhiteSpace($env:PAPER_MARKET_DATA_URL)) {
    $marketDataStatus = "url host: {0}" -f (Get-UrlHost $env:PAPER_MARKET_DATA_URL)
  } elseif (-not [string]::IsNullOrWhiteSpace($env:PAPER_POLYMARKET_TOKEN_ID)) {
    $marketDataStatus = "token id: {0}" -f (Mask-TokenForLog $env:PAPER_POLYMARKET_TOKEN_ID)
  } elseif (-not [string]::IsNullOrWhiteSpace($env:PAPER_FIXTURE_SCENARIO)) {
    $marketDataStatus = "fixture: {0}" -f $env:PAPER_FIXTURE_SCENARIO
  }

  Write-LauncherLog "Paper startup defaults:"
  Write-LauncherLog "  paper live: $env:PAPER_LIVE_MARKET_DATA"
  Write-LauncherLog "  simulated wallets: $env:PAPER_SIMULATE_WALLETS"
  Write-LauncherLog "  Predict paper wallets: $env:PAPER_SIM_PREDICT_WALLET_COUNT"
  Write-LauncherLog "  Predict wallet funds: $env:PAPER_SIM_PREDICT_WALLET_FUNDS_USD USD each"
  Write-LauncherLog "  Polymarket hedge funds: $env:PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD USD"
  Write-LauncherLog "  simulated net exposure: $env:PAPER_SIM_NET_EXPOSURE_USD USD"
  Write-LauncherLog "  worker interval: $env:DRY_RUN_WORKER_INTERVAL_MS ms"
  Write-LauncherLog "  market data: $marketDataStatus"
}

function Start-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$PidFile,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string]$LogFile
  )

  $root = Escape-SingleQuotedLiteral $ProjectRoot
  $title = Escape-SingleQuotedLiteral $Name
  $log = Escape-SingleQuotedLiteral $LogFile
  $processCommand = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location -LiteralPath '$root'; $Command *>> '$log'"
  $process = Start-Process powershell `
    -WindowStyle Hidden `
    -PassThru `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $processCommand)

  Set-Content -LiteralPath $PidFile -Value ([string]$process.Id) -Encoding ASCII
  Write-LauncherLog "Started $Name (pid $($process.Id))."
}

function Test-DryRunWorker {
  return (Find-ProjectProcess "src/workers/dry-run-hedge-worker.ts").Count -gt 0
}

function Test-DashboardApi {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3070/api/health" -TimeoutSec 2
    return $health.ok -eq $true `
      -and $health.mode -eq "dry_run" `
      -and $health.readOnly -eq $true `
      -and $health.liveTradingEnabled -eq $false `
      -and $health.dryRun -eq $true `
      -and $health.executable -eq $false
  } catch {
    return $false
  }
}

function Test-FreshDashboardStatus {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:3070/api/dashboard-status" -TimeoutSec 2
    $validDataSource = $status.dataSource -eq "latest_file" -or $status.dataSource -eq "paper_live"
    return $status.apiStatus -eq "ok" `
      -and $validDataSource `
      -and $status.botStatus -ne "no_data" `
      -and $status.readOnly -eq $true `
      -and $status.liveTradingEnabled -eq $false
  } catch {
    return $false
  }
}

function Test-Frontend {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173" -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-TcpPort {
  param([Parameter(Mandatory = $true)][int]$Port)

  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync("127.0.0.1", $Port)
    return $task.Wait(500) -and $client.Connected
  } finally {
    $client.Dispose()
  }
}

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)][scriptblock]$Condition
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) {
      Write-LauncherLog "$Name is ready."
      return
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  throw "$Name did not become ready within $TimeoutSeconds seconds"
}

function Find-ProjectProcess {
  param([Parameter(Mandatory = $true)][string]$Pattern)

  $normalizedRoot = $ProjectRoot.ToLowerInvariant()
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine `
      -and $_.CommandLine.ToLowerInvariant().Contains($normalizedRoot) `
      -and $_.CommandLine.Contains($Pattern)
  })
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$LogDir = Join-Path $RuntimeDir "logs"
$LauncherLog = Join-Path $LogDir "dashboard-launcher.log"
$LatestPath = Resolve-ProjectPath ($env:HEDGE_DASHBOARD_LATEST_PATH) (Join-Path $ProjectRoot "data\hedge-plans.latest.json")
$HistoryPath = Resolve-ProjectPath ($env:HEDGE_DASHBOARD_HISTORY_PATH) (Join-Path $ProjectRoot "data\hedge-plans.history.jsonl")

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null
Set-Location -LiteralPath $ProjectRoot

$env:HEDGE_DASHBOARD_LATEST_PATH = $LatestPath
$env:HEDGE_DASHBOARD_HISTORY_PATH = $HistoryPath
Remove-Item Env:\HEDGE_DASHBOARD_SNAPSHOT -ErrorAction SilentlyContinue
Initialize-PaperDefaults

Write-LauncherLog "Starting Predict hedge dry-run dashboard from $ProjectRoot"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm is not available on PATH"
}

if (Test-DryRunWorker) {
  Write-LauncherLog "Dry-run worker is already running."
} else {
  Start-ManagedProcess `
    -Name "Predict Hedge Dry-Run Worker" `
    -PidFile (Join-Path $RuntimeDir "dry-run-worker.pid") `
    -Command "pnpm bot:dry-run" `
    -LogFile (Join-Path $LogDir "dry-run-worker.log")
}

Wait-Until -Name "latest hedge plan file" -TimeoutSeconds 45 -Condition {
  Test-Path -LiteralPath $LatestPath
}

if (Test-DashboardApi) {
  Write-LauncherLog "Dashboard API is already running."
} elseif (Test-TcpPort 3070) {
  throw "Port 3070 is already in use, but /api/health did not pass dry-run checks. Run scripts\restart-dashboard.ps1."
} else {
  Start-ManagedProcess `
    -Name "Predict Hedge Dashboard API" `
    -PidFile (Join-Path $RuntimeDir "dashboard-api.pid") `
    -Command "pnpm dashboard:api" `
    -LogFile (Join-Path $LogDir "dashboard-api.log")
}

Wait-Until -Name "dashboard API health" -TimeoutSeconds 45 -Condition {
  Test-DashboardApi
}

Wait-Until -Name "fresh dashboard status" -TimeoutSeconds 45 -Condition {
  Test-FreshDashboardStatus
}

if (Test-Frontend) {
  Write-LauncherLog "Dashboard frontend is already running."
} elseif (Test-TcpPort 5173) {
  throw "Port 5173 is already in use, but the dashboard frontend did not pass readiness checks. Run scripts\restart-dashboard.ps1."
} else {
  Start-ManagedProcess `
    -Name "Predict Hedge Dashboard Frontend" `
    -PidFile (Join-Path $RuntimeDir "dashboard-frontend.pid") `
    -Command "pnpm dashboard:frontend" `
    -LogFile (Join-Path $LogDir "dashboard-frontend.log")
}

Wait-Until -Name "dashboard frontend" -TimeoutSeconds 60 -Condition {
  Test-Frontend
}

Write-LauncherLog "Dashboard ready at http://127.0.0.1:5173"
Start-Process "http://127.0.0.1:5173"
