@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wg-toggle.ps1" down %1
