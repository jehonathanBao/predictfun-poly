@echo off
setlocal

REM Start the read-only Predict hedge dry-run dashboard.
REM Keep this file ASCII-only so cmd.exe can parse it on any Windows code page.
set "ROOT=%~dp0"
cd /d "%ROOT%"

call :CheckApi
if errorlevel 1 (
  REM Start dashboard API in a visible PowerShell window.
  start "Predict Hedge Dashboard API" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -Command "Set-Location -LiteralPath '%ROOT%'; pnpm dashboard:api"

  echo Waiting for dashboard API on port 3070 ...
  call :WaitForPort 3070
  if errorlevel 1 (
    echo Dashboard API did not become ready.
    echo Check the "Predict Hedge Dashboard API" PowerShell window for errors.
    pause
    exit /b 1
  )
) else (
  echo Dashboard API is already running.
)

call :CheckFrontend
if errorlevel 1 (
  REM Start Vite frontend in a visible PowerShell window.
  start "Predict Hedge Dashboard Frontend" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -Command "Set-Location -LiteralPath '%ROOT%'; pnpm dashboard:frontend"

  echo Waiting for dashboard frontend on port 5173 ...
  call :WaitForPort 5173
  if errorlevel 1 (
    echo Dashboard frontend did not become ready.
    echo Check the "Predict Hedge Dashboard Frontend" PowerShell window for errors.
    pause
    exit /b 1
  )
) else (
  echo Dashboard frontend is already running.
)

REM Open the dashboard in the default browser.
start "" "http://localhost:5173"

endlocal
exit /b 0

:CheckApi
powershell -NoProfile -ExecutionPolicy Bypass -Command "$client=[Net.Sockets.TcpClient]::new(); try { $task=$client.ConnectAsync('127.0.0.1', 3070); if ($task.Wait(500) -and $client.Connected) { exit 0 }; exit 1 } finally { $client.Dispose() }"
exit /b %errorlevel%

:CheckFrontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "$client=[Net.Sockets.TcpClient]::new(); try { $task=$client.ConnectAsync('127.0.0.1', 5173); if ($task.Wait(500) -and $client.Connected) { exit 0 }; exit 1 } finally { $client.Dispose() }"
exit /b %errorlevel%

:WaitForPort
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=[int]%~1; $deadline=(Get-Date).AddSeconds(45); do { $client=[Net.Sockets.TcpClient]::new(); try { $task=$client.ConnectAsync('127.0.0.1', $port); if ($task.Wait(500) -and $client.Connected) { exit 0 } } finally { $client.Dispose() }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
exit /b %errorlevel%
