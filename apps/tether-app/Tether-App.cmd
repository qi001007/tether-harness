@echo off
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
set "TETHER_PY=..\..\.venv\Scripts\python.exe"
if not exist "%TETHER_PY%" goto bootstrap
"%TETHER_PY%" -c "import websockets, tether.node.agent" >nul 2>&1
if errorlevel 1 goto bootstrap
goto dependencies
:bootstrap
echo [tether] preparing Python runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File "bootstrap-app.ps1"
if errorlevel 1 exit /b 1
:dependencies
if not exist "node_modules\electron\dist\electron.exe" (
  echo [tether] installing app dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm start