@echo off
rem ============================================================================================
rem  Cout de revient CH - variante personnelle
rem
rem  Double-cliquez ce fichier : il construit la variante privee, sert dist/ sur 127.0.0.1 et
rem  ouvre une fenetre de navigateur SANS barre d'adresse, sur l'origine dediee
rem  http://crch.localhost:7331
rem
rem  Ce fichier n'est qu'une enveloppe : toute la logique, et les raisons de chaque choix, vivent
rem  dans scripts\lancer-prive.ps1. Une enveloppe .cmd existe parce qu'un double-clic sur un .ps1
rem  ouvre le Bloc-notes au lieu de l'executer.
rem
rem  `pwsh` (PowerShell 7) est prefere : il lit l'UTF-8 par defaut. Repli sur `powershell` 5.1,
rem  toujours present sur Windows.
rem ============================================================================================
setlocal
cd /d "%~dp0"

where pwsh >nul 2>&1
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "scripts\lancer-prive.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\lancer-prive.ps1" %*
)

if %ERRORLEVEL% neq 0 (
  echo.
  echo Le lancement a echoue. Le detail est au-dessus.
  pause
)
endlocal
