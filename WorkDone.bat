@echo off
rem WorkDone Management System - double-click to install (first run), set up and start.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
