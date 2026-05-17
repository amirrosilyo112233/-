@echo off
chcp 65001 >nul
title המורה הפרטי שלי - מפעיל

echo ========================================
echo    מאתחל הכל מחדש...
echo ========================================

REM Kill old processes
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo [1/2] מפעיל שרת...
start "Backend - אל תסגור" cmd /k "cd /d %~dp0backend && node server.js"
timeout /t 3 /nobreak >nul

echo [2/2] מפעיל ממשק...
start "Frontend - אל תסגור" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo ========================================
echo    ✅ הכל פועל!
echo    פותח את האפליקציה...
echo ========================================
start http://localhost:5173
