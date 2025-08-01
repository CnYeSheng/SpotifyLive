# ⚡ 快速啟動指南

你的 Spotify 憑證已經設定好了！現在只需要幾個步驟就能開始使用。

## 🚀 立即啟動

### 步驟 1: 安裝 Node.js (如果還沒有)
前往 [nodejs.org](https://nodejs.org/) 下載並安裝 LTS 版本

### 步驟 2: 啟動應用程式
雙擊 `start.bat` 檔案，或在命令列執行：
```bash
npm install
npm start
```

### 步驟 3: 開啟瀏覽器
前往 `https://localhost:3000`

⚠️ **重要**: 瀏覽器會顯示安全警告，這是正常的！點擊 **"進階"** → **"繼續前往 localhost"**

### 步驟 4: 連接 Spotify
1. 點擊 **"連接 Spotify"** 按鈕
2. 登入你的 Spotify 帳戶
3. 授權應用程式

### 步驟 5: 享受音樂！
在 Spotify 中播放任何歌曲，網站會自動顯示歌曲信息和歌詞！

## 🎵 功能預覽

✅ **即時音樂顯示** - 專輯封面、歌曲名稱、藝術家  
✅ **播放進度** - 即時進度條和時間顯示  
✅ **即時歌詞** - 自動載入並同步滾動  
✅ **美觀界面** - Apple Music 風格設計  
✅ **自訂選項** - 字體大小、自動滾動  

## 🔧 如果遇到問題

### "找不到 Node.js"
安裝 Node.js 並重新啟動命令提示字元

### "端口已被使用"
修改 `.env` 檔案中的 `PORT=3001`

### "Authentication failed"
檢查 Spotify Developer Dashboard 中的設定：
- Redirect URI 必須是 `https://localhost:3000/callback`

### "沒有正在播放的音樂"
確保 Spotify 正在播放音樂並已正確授權

## 📱 支援的平台

- ✅ Windows (Chrome, Edge, Firefox)
- ✅ macOS (Safari, Chrome, Firefox)  
- ✅ Linux (Chrome, Firefox)
- ✅ 行動裝置 (響應式設計)

---

🎉 **就是這麼簡單！現在開始享受你的音樂和歌詞體驗吧！** 🎵