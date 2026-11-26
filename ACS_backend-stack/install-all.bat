@echo off
setlocal
cd /d "%~dp0backend"
echo Installing shared dependencies for all six APIs...
call npm install
if errorlevel 1 (
  echo.
  echo Dependency installation failed. Check your internet connection and npm output.
  pause
  exit /b 1
)
echo.
echo All shared backend dependencies installed successfully.
pause
