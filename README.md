# 🎵 Spotify 即時歌詞播放器

一個美觀的網頁應用程式，可以顯示你正在 Spotify 播放的音樂並提供即時歌詞功能，就像 Apple Music 一樣！

## ✨ 功能特色

- 🎵 **即時音樂顯示** - 顯示當前在 Spotify 播放的歌曲信息
- 🎤 **即時歌詞** - 自動載入並顯示歌詞，支援滾動同步
- 🎨 **美觀界面** - 現代化的毛玻璃設計，支援響應式佈局
- ⚡ **即時更新** - 自動檢測歌曲變化和播放進度
- 🔧 **自訂選項** - 可調整字體大小、自動滾動等設定
- 📱 **跨平台** - 支援桌面和行動裝置

## 🚀 快速開始

### 1. 設定 Spotify 開發者帳戶

1. 前往 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 登入你的 Spotify 帳戶
3. 點擊 "Create App"
4. 填寫應用程式資訊：
   - App name: `Spotify Lyrics Player`
   - App description: `A web app to display currently playing music with lyrics`
   - Redirect URI: `https://localhost:3000/callback`
5. 記下你的 `Client ID` 和 `Client Secret`

### 2. 安裝和設定

```bash
# 安裝依賴
npm install

# 複製環境變數範本
cp .env.example .env

# 編輯 .env 檔案，填入你的 Spotify API 憑證
```

在 `.env` 檔案中填入：
```env
SPOTIFY_CLIENT_ID=你的_spotify_client_id
SPOTIFY_CLIENT_SECRET=你的_spotify_client_secret
REDIRECT_URI=https://localhost:3000/callback
PORT=3000
```

### 3. 啟動應用程式

```bash
# 開發模式
npm run dev

# 或正式啟動
npm start
```

### 4. 使用應用程式

1. 開啟瀏覽器前往 `https://localhost:3000`
2. 點擊 "連接 Spotify" 按鈕
3. 授權應用程式存取你的 Spotify 帳戶
4. 在 Spotify 中播放音樂
5. 享受即時歌詞功能！

## 🛠️ 技術架構

### 後端 (Node.js + Express)
- **Spotify Web API** - 獲取當前播放的音樂資訊
- **Lyrics API** - 獲取歌詞數據 (使用 lyrics.ovh)
- **OAuth 2.0** - 安全的 Spotify 帳戶認證

### 前端 (Vanilla JavaScript + CSS)
- **現代化 UI** - 毛玻璃效果和流暢動畫
- **響應式設計** - 適配各種螢幕尺寸
- **即時更新** - WebSocket 風格的即時數據同步

## 📁 專案結構

```
spotify-lyrics-player/
├── server.js              # Express 伺服器
├── package.json           # 專案依賴
├── .env.example          # 環境變數範本
├── README.md             # 專案說明
└── public/               # 前端檔案
    ├── index.html        # 主頁面
    ├── styles.css        # 樣式表
    └── script.js         # JavaScript 邏輯
```

## 🎛️ API 端點

- `GET /auth` - 開始 Spotify OAuth 流程
- `GET /callback` - OAuth 回調處理
- `GET /api/current-track` - 獲取當前播放的歌曲
- `GET /api/lyrics/:artist/:title` - 獲取歌詞
- `GET /api/auth-status` - 檢查認證狀態

## 🔧 自訂功能

### 歌詞來源
目前使用 lyrics.ovh API，你可以替換為其他歌詞服務：
- Genius API
- Musixmatch API
- LyricFind API

### 界面自訂
- 調整 `public/styles.css` 來修改外觀
- 修改顏色主題、字體、佈局等

## 🐛 常見問題

### Q: 為什麼顯示 "沒有正在播放的音樂"？
A: 確保你在 Spotify 中正在播放音樂，並且已經正確授權應用程式。

### Q: 歌詞顯示不正確或找不到？
A: 歌詞來源可能沒有該歌曲的數據，或者藝術家/歌曲名稱不匹配。

### Q: 如何在生產環境部署？
A: 
1. 設定正確的 `REDIRECT_URI`
2. 使用 HTTPS
3. 設定環境變數
4. 使用 PM2 或類似工具管理程序

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！

## 📄 授權

MIT License - 詳見 LICENSE 檔案

## 🙏 致謝

- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [lyrics.ovh](https://lyrics.ovh/) - 歌詞 API 服務
- [Inter Font](https://rsms.me/inter/) - 美觀的字體

---

享受你的音樂和歌詞體驗！🎵✨