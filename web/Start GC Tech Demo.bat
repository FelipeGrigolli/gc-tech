@echo off
rem Starts the GC Tech prototype on http://localhost:8080 and opens the browser.
rem Keep the server window open during the demo. Close it to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\gc-server.ps1"
