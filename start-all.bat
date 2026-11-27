@echo off
setlocal
cd /d "%~dp0backend"
if not exist "%~dp0.env" (
  echo Missing project-root .env. Copy .env.example to .env and fill in the Supabase values first.
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Backend dependencies are missing. Run install-all.bat first.
  pause
  exit /b 1
)
echo Starting the centralized ACS API on port 3000...
echo All API modules are mounted in this single Node.js process.
node server.js
