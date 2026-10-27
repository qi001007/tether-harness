@echo off
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [tether] installing app dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm start