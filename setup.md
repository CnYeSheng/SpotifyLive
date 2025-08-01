# 🚀 設定指南

## 步驟 1: 安裝 Node.js

如果你還沒有安裝 Node.js，請：

1. 前往 [Node.js 官網](https://nodejs.org/)
2. 下載並安裝 LTS 版本
3. 重新啟動命令提示字元

## 步驟 2: 設定 Spotify 開發者帳戶

1. 前往 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 使用你的 Spotify 帳戶登入
3. 點擊 **"Create App"**
4. 填寫應用程式資訊：
   ```
   App name: Spotify Lyrics Player
   App description: A web app to display currently playing music with lyrics
   Website: https://localhost:3000
   Redirect URI: https://localhost:3000/callback
   ```
5. 勾選同意條款並點擊 **"Save"**
6. 在應用程式頁面中，點擊 **"Settings"**
7. 複製你的 **Client ID** 和 **Client Secret**

## 步驟 3: 設定環境變數

1. 複製 `.env.example` 檔案並重新命名為 `.env`
2. 開啟 `.env` 檔案
3. 將你的 Spotify 憑證填入：
   ```env
   SPOTIFY_CLIENT_ID=你的_client_id_這裡
   SPOTIFY_CLIENT_SECRET=你的_client_secret_這裡
   REDIRECT_URI=https://localhost:3000/callback
   PORT=3000
   ```

## 步驟 4: 安裝依賴並啟動

### 方法 1: 使用批次檔案 (推薦)
雙擊 `start.bat` 檔案

### 方法 2: 使用命令列
```bash
# 安裝依賴
npm install

# 啟動應用程式
npm start
```

## 步驟 5: 使用應用程式

1. 開啟瀏覽器前往 `https://localhost:3000`
2. 點擊 **"連接 Spotify"** 按鈕
3. 登入並授權應用程式
4. 在 Spotify 中播放音樂
5. 享受即時歌詞功能！

## 🔧 故障排除

### 問題: "未找到 Node.js"
**解決方案**: 安裝 Node.js 並重新啟動命令提示字元

### 問題: "找不到 .env 檔案"
**解決方案**: 確保你已經創建 `.env` 檔案並填入正確的 Spotify 憑證

### 問題: "Authentication failed"
**解決方案**: 
- 檢查 Client ID 和 Client Secret 是否正確
- 確保 Redirect URI 設定為 `http://localhost:3000/callback`

### 問題: "沒有正在播放的音樂"
**解決方案**: 
- 確保 Spotify 正在播放音樂
- 檢查是否已正確授權應用程式
- 嘗試重新整理頁面

### 問題: "找不到歌詞"
**解決方案**: 
- 歌詞服務可能沒有該歌曲的數據
- 嘗試播放其他熱門歌曲

## 🎵 享受你的音樂體驗！