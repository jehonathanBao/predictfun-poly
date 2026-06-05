$ErrorActionPreference = "Continue"

function Stop-PidFile {
  param([Parameter(Mandatory = $true)][string]$PidFile)

  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Warning "Missing pid file: $PidFile"
    return
  }

  $raw = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) {
    Write-Warning "Invalid pid file: $PidFile"
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($process -eq $null) {
    Write-Warning "Process $pidValue is not running."
  } else {
    try {
      Write-Host "Stopping pid $pidValue from $PidFile"
      Stop-Process -Id $pidValue -Force -ErrorAction Stop
    } catch {
      Write-Warning ("Could not stop pid {0}: {1}" -f $pidValue, $_.Exception.Message)
    }
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Find-ProjectProcesses {
  param([Parameter(Mandatory = $true)][string[]]$Patterns)

  $normalizedRoot = $ProjectRoot.ToLowerInvariant()
  @(Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    if (-not $commandLine) {
      $false
    } else {
      $normalizedCommand = $commandLine.ToLowerInvariant()
      $matchesProject = $normalizedCommand.Contains($normalizedRoot)
      $matchesPattern = $false
      foreach ($pattern in $Patterns) {
        if ($commandLine.Contains($pattern)) {
          $matchesPattern = $true
        }
      }
      $matchesProject -and $matchesPattern
    }
  })
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"

Set-Location -LiteralPath $ProjectRoot

Write-Host "Stopping Predict hedge dashboard processes..."

Stop-PidFile (Join-Path $RuntimeDir "dry-run-worker.pid")
Stop-PidFile (Join-Path $RuntimeDir "dashboard-api.pid")
Stop-PidFile (Join-Path $RuntimeDir "dashboard-frontend.pid")

$patterns = @(
  "src/workers/dry-run-hedge-worker.ts",
  "src/server/hedge-dashboard.ts",
  "dashboard:api",
  "dashboard:frontend",
  "pnpm --dir frontend dev",
  "vite"
)

foreach ($process in Find-ProjectProcesses $patterns) {
  try {
    Write-Host ("Stopping project process pid {0}: {1}" -f $process.ProcessId, $process.Name)
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {
    Write-Warning ("Could not stop pid {0}: {1}" -f $process.ProcessId, $_.Exception.Message)
  }
}

if (Test-Path -LiteralPath $RuntimeDir) {
  Remove-Item -LiteralPath (Join-Path $RuntimeDir "*.pid") -Force -ErrorAction SilentlyContinue
}

Write-Host "Dashboard stop completed."
