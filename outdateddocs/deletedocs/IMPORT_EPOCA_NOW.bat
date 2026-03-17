@echo off
REM Quick script to import Epoca data right now

echo.
echo ====================================================
echo  IMPORTING EPOCA MARKETING DATA
echo ====================================================
echo.

cd %~dp0\services\data-engine

REM Activate venv
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo ERROR: Virtual environment not found!
    echo Run this first: python -m venv venv
    pause
    exit /b 1
)

REM Set Python path
set PYTHONPATH=%CD%\..\mcp-servers;%CD%\..;%PYTHONPATH%

REM Run sync for Epoca (using actual property ID from database)
echo Importing data for Epoca property...
echo Property ID: eaa3d41f-a182-4a3b-b0e8-935a7f90053a
echo Date Range: Last 30 days
echo.

python -m pipelines.mcp_marketing_sync --property-id eaa3d41f-a182-4a3b-b0e8-935a7f90053a --date-range LAST_30_DAYS

echo.
echo ====================================================
echo  IMPORT COMPLETE!
echo ====================================================
echo.
echo Now go to: http://localhost:3000/dashboard/bi
echo Select: Epoca property
echo Data should be visible!
echo.
pause





