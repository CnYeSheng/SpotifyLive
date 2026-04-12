# 🚀 Vercel 部署完整指南

## 📋 部署前準備

### 1. 設置 Spotify 開發者應用程式

1. 前往 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 點擊 "Create an App"
3. 填寫應用程式信息：
   - **App name**: Spotify Lyrics Player
   - **App description**: Enhanced Spotify lyrics player with real-time sync
   - **Website**: 您的網站 URL（可選）
   - **Redirect URI**: `https://your-app-name.vercel.app/api/callback`
4. 勾選同意條款，點擊 "Create"
5. 記錄 **Client ID** 和 **Client Secret**

## 🌐 部署到 Vercel

### 方法一：通過 GitHub（推薦）

1. **推送代碼到 GitHub**
   ```bash
   git add .
   git commit -m "Ready for Vercel deployment"
   git push origin main
   ```

2. **連接 Vercel**
   - 前往 [Vercel Dashboard](https://vercel.com)
   - 點擊 "New Project"
   - 選擇您的 GitHub 倉庫
   - 點擊 "Import"

3. **配置項目**
   - **Framework Preset**: Other
   - **Root Directory**: `./` (默認)
   - **Build Command**: `npm run vercel-build`
   - **Output Directory**: `public`

4. **設置環境變數**
   在 Environment Variables 部分添加：
   ```
   SPOTIFY_CLIENT_ID = your_actual_client_id
   SPOTIFY_CLIENT_SECRET = your_actual_client_secret
   REDIRECT_URI = https://your-app-name.vercel.app/api/callback
   ```

5. **部署**
   - 點擊 "Deploy"
   - 等待部署完成

### 方法二：使用 Vercel CLI

1. **安裝 Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **登入 Vercel**
   ```bash
   vercel login
   ```

3. **初始化項目**
   ```bash
   vercel
   ```
   按照提示配置項目設置

4. **設置環境變數**
   ```bash
   vercel env add SPOTIFY_CLIENT_ID
   vercel env add SPOTIFY_CLIENT_SECRET
   vercel env add REDIRECT_URI
   ```

5. **部署到生產環境**
   ```bash
   vercel --prod
   ```

## ⚙️ 部署後配置

### 1. 更新 Spotify 應用程式設置

部署完成後，您會獲得一個 Vercel URL（例如：`https://spotify-lyrics-player.vercel.app`）

1. 回到 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 選擇您的應用程式
3. 點擊 "Edit Settings"
4. 在 "Redirect URIs" 中添加：
   ```
   https://your-actual-vercel-url.vercel.app/api/callback
   ```
5. 點擊 "Save"

### 2. 測試部署

1. 訪問您的 Vercel URL
2. 點擊 "連接 Spotify"
3. 完成 Spotify 授權
4. 測試所有功能

## 🎯 功能檢查清單

部署後請確認以下功能正常工作：

- [ ] ✅ Spotify 登入和授權
- [ ] 🎵 顯示當前播放歌曲
- [ ] ⏯️ 播放/暫停控制
- [ ] ⏭️ 上一首/下一首
- [ ] 🔀 隨機播放切換
- [ ] 🔁 重複播放切換
- [ ] 🔊 音量控制
- [ ] 📱 設備投放
- [ ] 📋 播放清單查看
- [ ] ❤️ 加入已按讚歌曲
- [ ] 🎨 專輯封面背景
- [ ] 📝 歌詞顯示

## 🔧 自定義域名（可選）

### 1. 在 Vercel 中添加域名

1. 前往 Vercel Dashboard > Settings > Domains
2. 添加您的自定義域名
3. 按照指示配置 DNS 記錄

### 2. 更新環境變數

更新 `REDIRECT_URI` 環境變數：
```
REDIRECT_URI = https://your-custom-domain.com/api/callback
```

### 3. 更新 Spotify 設置

在 Spotify Developer Dashboard 中添加新的 Redirect URI：
```
https://your-custom-domain.com/api/callback
```

## 🐛 故障排除

### 常見問題

1. **"Invalid redirect URI" 錯誤**
   - 檢查 Spotify 應用程式中的 Redirect URIs
   - 確保 URL 完全匹配（包括 https://）

2. **"Invalid client" 錯誤**
   - 檢查 `SPOTIFY_CLIENT_ID` 環境變數
   - 確認 Client ID 正確

3. **"Unauthorized" 錯誤**
   - 檢查 `SPOTIFY_CLIENT_SECRET` 環境變數
   - 確認 Client Secret 正確

4. **功能按鈕不工作**
   - 確認您有 Spotify Premium（某些功能需要）
   - 檢查瀏覽器控制台錯誤

### 調試步驟

1. **檢查 Vercel 函數日誌**
   ```bash
   vercel logs
   ```

2. **檢查環境變數**
   ```bash
   vercel env ls
   ```

3. **本地測試**
   ```bash
   # 複製環境變數
   cp .env.example .env
   # 編輯 .env 文件，填入實際值
   
   # 本地運行
   npm run dev
   ```

## 📊 性能優化

### 1. 啟用 Vercel Analytics（可選）
```bash
npm install @vercel/analytics
```

### 2. 配置緩存
在 `vercel.json` 中已配置適當的緩存策略

### 3. 監控使用情況
- 查看 Vercel Dashboard 中的 Analytics
- 監控 API 調用次數
- 檢查函數執行時間

## 🔒 安全最佳實踐

1. **環境變數安全**
   - 永遠不要在代碼中硬編碼密鑰
   - 定期輪換 Spotify Client Secret

2. **CORS 配置**
   - 已在 `api/index.js` 中配置適當的 CORS

3. **會話管理**
   - 當前使用內存存儲（適合小型應用）
   - 大型應用建議使用 Redis 或數據庫

## 📞 獲得幫助

如果遇到問題：

1. 檢查 [Vercel 文檔](https://vercel.com/docs)
2. 查看 [Spotify Web API 文檔](https://developer.spotify.com/documentation/web-api/)
3. 檢查項目的 GitHub Issues
4. 查看瀏覽器開發者工具的控制台錯誤

## 🎉 部署成功！

恭喜！您的 Spotify 歌詞播放器現在已經在 Vercel 上運行了。享受您的音樂體驗吧！