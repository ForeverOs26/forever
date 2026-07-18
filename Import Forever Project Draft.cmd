@echo off
start "Forever Draft Project Import" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0scripts\import\Start-ForeverProjectDraftImport.ps1"
