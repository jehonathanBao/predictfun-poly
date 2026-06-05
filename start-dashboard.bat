@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-dashboard-full.ps1"

endlocal
exit /b %errorlevel%
