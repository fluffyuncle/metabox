@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

call "%~dp0scripts\busybox.cmd" sh "%~dp0start.sh" %*

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Script terminated with an error (Code: %ERRORLEVEL%)
)

pause