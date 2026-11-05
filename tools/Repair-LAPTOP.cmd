@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-laptop-node.ps1"
pause