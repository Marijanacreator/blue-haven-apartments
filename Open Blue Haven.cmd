@echo off
cd /d "%~dp0"
start "Blue Haven Website" http://127.0.0.1:8080/
node --env-file-if-exists=.env.local server.js
pause
