@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
if errorlevel 1 (
  echo Shortcut creation failed. See the message above.
  pause
  exit /b 1
)
pause
