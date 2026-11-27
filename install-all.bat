@echo off
setlocal
cd /d "%~dp0backend"
echo Installing dependencies for the centralized ACS API...
call npm install
if errorlevel 1 (
  echo.
  echo Dependency installation failed. Check your internet connection and npm output.
  pause
  exit /b 1
)
echo.
echo ACS API dependencies installed successfully.
pause
