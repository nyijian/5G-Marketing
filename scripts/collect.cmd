@echo off
rem 5G tender monitor - scheduled / double-click runner (Windows).
rem   scripts\collect.cmd                 -> pnpm collect --days 3   (daily default)
rem   scripts\collect.cmd --days 7        -> any pnpm collect arguments
rem   scripts\collect.cmd --check-env     -> only check node/pnpm, no collection
rem Output is appended to output\collect.log.

setlocal
cd /d "%~dp0.."

rem Task Scheduler does not load the fnm shell hook; initialise it here.
where fnm >nul 2>nul && for /f "tokens=*" %%z in ('fnm env --shell cmd') do call %%z

if /i "%~1"=="--check-env" (
  where node && node --version
  where pnpm && call pnpm --version
  exit /b %errorlevel%
)

if "%~1"=="" (set "ARGS=--days 3") else (set "ARGS=%*")

if not exist output mkdir output
echo ===== %date% %time%  pnpm collect %ARGS% >> "output\collect.log"
call pnpm collect %ARGS% >> "output\collect.log" 2>&1
set "CODE=%errorlevel%"
echo ===== exit code %CODE% >> "output\collect.log"
exit /b %CODE%
