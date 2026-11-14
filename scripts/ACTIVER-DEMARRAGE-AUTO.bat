@echo off
rem Kebab - active le demarrage automatique du site (double-clic). Aucun droit administrateur requis.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-demarrage-auto.ps1"
echo.
pause
