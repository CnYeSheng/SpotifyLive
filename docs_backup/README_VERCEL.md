# Spotify 歌詞播放器 - Vercel 部署指南

## 🚀 部署到 Vercel

### 1. 準備工作

#### 設置 Spotify 應用程式
1. 前往 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 創建新應用程式
3. 記錄 `Client ID` 和 `Client Secret`
4. 在 Redirect URIs 中添加：`https://your-app-name.vercel.app/api/callback`

### 2. 部署步驟

#### 方法一：GitHub 連接（推薦）
1. 將代碼推送到 GitHub 倉庫
2. 前往 [Vercel Dashboard](https://vercel.com/dashboard)
3. 點擊 "New Project"
4. 選擇您的 GitHub 倉庫
5. 配置環境變數（見下方）
6. 點擊 "Deploy"

#### 方法二：Vercel CLI
```bash
# 安裝 Vercel CLI
npm i -g vercel

# 登入 Vercel
vercel login

# 部署
vercel

# 設置環境變數
vercel env add SPOTIFY_CLIENT_ID
vercel env add SPOTIFY_CLIENT_SECRET
vercel env add REDIRECT_URI

# 重新部署
vercel --prod
```

### 3. 環境變數設置

在 Vercel Dashboard 的 Settings > Environment Variables 中添加：

| 變數名 | 值 | 說明 |
|--------|-----|------|
| `SPOTIFY_CLIENT_ID` | `your_client_id` | Spotify 應用程式 Client ID |
| `SPOTIFY_CLIENT_SECRET` | `your_client_secret` | Spotify 應用程式 Client Secret |
| `REDIRECT_URI` | `https://your-app.vercel.app/api/callback` | 回調 URL |

### 4. 更新 Spotify 應用程式設置

部署完成後，更新 Spotify 應用程式的 Redirect URIs：
- 添加：`https://your-actual-domain.vercel.app/api/callback`
- 如果有自定義域名，也要添加該域名的回調 URL

### 5. 功能說明

#### ✅ Vercel 支援的功能
- 🎵 即時歌曲信息顯示
- 🎛️ 完整播放控制（播放/暫停/上一首/下一首）
- 🔀 隨機播放和重複播放控制
- 🔊 音量控制和設備切換
- 📱 設備投放功能
- 📋 播放清單管理
- ❤️ 加入已按讚的歌曲
- 🎨 專輯封面背景效果

#### ⚠️ 限制
- **歌詞功能**: 僅支援 lyrics.ovh API（無同步歌詞）
- **會話存儲**: 使用內存存儲（重啟後會丟失）

### 6. 自定義域名（可選）

1. 在 Vercel Dashboard 中前往 Settings > Domains
2. 添加您的自定義域名
3. 配置 DNS 記錄
4. 更新 Spotify 應用程式的 Redirect URIs

### 7. 監控和調試

#### 查看日誌
```bash
vercel logs your-app-name
```

#### 本地測試
```bash
# 安裝依賴
npm install

# 設置環境變數
cp .env.example .env
# 編輯 .env 文件

# 本地運行
npm run dev
```

### 8. 故障排除

#### 常見問題

1. **認證失敗**
   - 檢查環境變數是否正確設置
   - 確認 Redirect URI 匹配

2. **API 錯誤**
   - 檢查 Spotify 應用程式權限
   - 確認 Client ID 和 Secret 正確

3. **部署失敗**
   - 檢查 package.json 依賴
   - 查看 Vercel 部署日誌

#### 調試技巧
- 使用 Vercel 的 Function Logs 查看錯誤
- 檢查瀏覽器開發者工具的網絡請求
- 確保所有 API 路徑以 `/api/` 開頭

### 9. 性能優化

- 使用 Vercel 的邊緣函數加速
- 啟用 gzip 壓縮
- 優化圖片載入
- 使用 CDN 加速靜態資源

### 10. 安全考慮

- 環境變數安全存儲
- CORS 設置正確
- 定期更新依賴包
- 監控異常訪問

## 📞 支援

如果遇到問題，請檢查：
1. Vercel 部署日誌
2. 瀏覽器控制台錯誤
3. Spotify API 文檔
4. 本項目的 GitHub Issues