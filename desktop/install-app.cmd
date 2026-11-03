@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-app.ps1"
if errorlevel 1 (
  echo.
  echo Tether APP installation failed. Keep this window and check the message above.
  pause
)
