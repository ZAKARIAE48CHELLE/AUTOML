@echo off
echo ========================================================
echo    AutoML Unified Studio Web Interface Launcher
echo ========================================================
cd /d "%~dp0"
echo Starting FastAPI application on http://localhost:8501 ...
python -m uvicorn app:app --host 0.0.0.0 --port 8501 --reload
pause
