@echo off
setlocal
set "DEST=D:\Tether\deploy\tether-app-0.2.3\tether\node"
if not exist "%DEST%" (
  echo Node folder not found: %DEST%
  echo Open the Tether APP once, then run this file again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -UseBasicParsing -Uri 'https://8-220-198-26.sslip.io/install/dsh_web.py' -OutFile '%DEST%\dsh_web.py';" ^
  "Invoke-WebRequest -UseBasicParsing -Uri 'https://8-220-198-26.sslip.io/install/dsh_web_run.py' -OutFile '%DEST%\dsh_web_run.py'"
if errorlevel 1 (
  echo Repair download failed. Check the network and retry.
  pause
  exit /b 1
)
echo Repair files installed. Reopen the Tether APP to start this node.
pause
