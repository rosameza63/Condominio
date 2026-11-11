@echo off
cd /d "%~dp0"
set PORT=3001
where node >nul 2>nul
if %errorlevel%==0 (
  node server-local.js
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server-local.js
) else (
  echo No se encontro Node.js en este computador.
  echo Pide ayuda para instalarlo o publicar la app.
)
pause
