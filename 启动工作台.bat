@echo off
cd /d "%~dp0"
echo ============================================================
echo   小满AI - 电商客服聚合工作台
echo   项目目录: %cd%
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 18+ : https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\mysql2" (
  echo [提示] 未安装 MySQL 驱动 mysql2，将回落到本地 SQLite。
  echo        需要连接 MySQL 时请执行:
  echo        npm install mysql2 --registry=https://registry.npmmirror.com
  echo.
)
echo [信息] 正在启动，稍后浏览器会自动打开 http://127.0.0.1:8787
echo [信息] 关闭本窗口即停止服务。
echo.
start "" "http://127.0.0.1:8787"
node server.js
pause
