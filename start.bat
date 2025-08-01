@echo off
echo 正在啟動 Spotify 即時歌詞播放器...
echo.

REM 檢查 Node.js 是否已安裝
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 錯誤: 未找到 Node.js
    echo 請先安裝 Node.js: https://nodejs.org/
    pause
    exit /b 1
)

REM 檢查是否已安裝依賴
if not exist "node_modules" (
    echo 正在安裝依賴...
    npm install
    if %errorlevel% neq 0 (
        echo 安裝依賴失敗
        pause
        exit /b 1
    )
)

REM 檢查 .env 檔案
if not exist ".env" (
    echo 錯誤: 找不到 .env 檔案
    echo 請複製 .env.example 為 .env 並填入你的 Spotify API 憑證
    pause
    exit /b 1
)

echo.
echo 🎵 啟動伺服器...
echo 內部應用監聽: 0.0.0.0:3000
echo 外部訪問地址: https://live.cyss.us.eu.org
echo 請確保反向代理已設定
echo 按 Ctrl+C 停止伺服器
echo.

node server-proxy.js