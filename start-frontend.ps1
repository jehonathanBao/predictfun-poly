$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiCommand = "cd `"$root`"; pnpm dashboard:api"
$frontendCommand = "cd `"$root\frontend`"; pnpm install; pnpm dev"

Start-Process "powershell" -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", $apiCommand
Start-Sleep -Seconds 2
Start-Process "powershell" -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", $frontendCommand
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
