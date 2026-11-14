@echo off
REM SOUCOFFE - sauvegarde complete de la base de donnees (double-clic).
REM Cree Downloads\soucoffe_backups\auto\soucoffe_AAAA-MM-JJ_HHMM.sql
REM et garde les 30 dernieres sauvegardes. Ne modifie jamais la base.
setlocal
set "DUMP=C:\Program Files\MariaDB 13.0\bin\mariadb-dump.exe"
set "DEST=%~dp0..\..\soucoffe_backups\auto"
REM Identifiants lus dans le fichier .env du projet (jamais ecrits ici).
for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0..\.env") do (
    if "%%a"=="DB_USER" set "DB_USER=%%b"
    if "%%a"=="DB_PASSWORD" set "DB_PASSWORD=%%b"
    if "%%a"=="DB_NAME" set "DB_NAME=%%b"
)
if not defined DB_NAME set "DB_NAME=soucoffe"
if not defined DB_PASSWORD (
    echo ECHEC : fichier .env introuvable ou incomplet.
    pause
    exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%i"
set "FILE=%DEST%\soucoffe_%STAMP%.sql"
echo Sauvegarde en cours...
"%DUMP%" -u%DB_USER% -p%DB_PASSWORD% --single-transaction --routines --default-character-set=utf8mb4 %DB_NAME% > "%FILE%"
if errorlevel 1 (
    echo ECHEC : la base est-elle demarree ? Lancez d'abord scripts\start-lan.vbs
    del "%FILE%" 2>nul
    pause
    exit /b 1
)
REM Ne garde que les 30 sauvegardes les plus recentes.
powershell -NoProfile -Command "Get-ChildItem '%DEST%\soucoffe_*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item"
echo Sauvegarde terminee : %FILE%
pause
