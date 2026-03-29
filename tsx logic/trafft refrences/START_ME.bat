@echo off
TITLE AUTO TIMELINE SCRIPT RUNNER
color 0b

echo =======================================================
echo          STARTING AUTO TIMELINE ENGINE
echo =======================================================
echo.
echo Installing requirements (if needed)...
pip install flask flask-cors playwright
echo.
echo Installing Playwright Browsers (important for first run)...
playwright install chromium
echo.
echo -------------------------------------------------------
echo.
echo Starting the Python Backend Server...
echo (Please keep this terminal window OPEN)
echo.

start "" http://localhost:5050

cd auto-timeline
python backend_server.py

pause
