@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tether-laptop-diagnostics.ps1"
pause