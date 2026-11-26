@echo off
setlocal
if not exist "%~dp0.env" (
  echo Missing project-root .env. Copy .env.example to .env and fill in the Supabase values first.
  pause
  exit /b 1
)
if not exist "%~dp0backend\node_modules\dotenv" (
  echo Shared backend dependencies are missing.
  echo Run install-all.bat once, then run start-all.bat again.
  pause
  exit /b 1
)
start "ACS Auth Users API - 3000" cmd /k "cd /d ""%~dp0backend\auth-users-api"" && npm start"
start "ACS Analytics API - 3001" cmd /k "cd /d ""%~dp0backend\analytics-audit-api"" && npm start"
start "ACS Services API - 3002" cmd /k "cd /d ""%~dp0backend\services-pricing-api"" && npm start"
start "ACS Orders Fulfillment API - 3003" cmd /k "cd /d ""%~dp0backend\orders-fulfillment-api"" && node server.js"
start "ACS Supply Inventory API - 3004" cmd /k "cd /d ""%~dp0backend\inventory-customer-api"" && node server.js"
start "ACS Live Messaging API - 3005" cmd /k "cd /d ""%~dp0backend\chat-api"" && node server.js"
echo Started six API terminal windows. Keep them open.
