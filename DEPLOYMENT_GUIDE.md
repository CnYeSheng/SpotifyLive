# Vercel 部署指南

## 修復總結

已添加以下缺失的 API 路由來解決 404 錯誤：

### 新增的 API 端點（共 15 個）

1. `POST /api/extract-colors` - 顏色提取
2. `GET /api/library/check/:trackId` - 檢查喜歡狀態
3. `POST /api/library/add` - 添加到喜歡列表
4. `POST /api/library/remove` - 從喜歡列表移除
5. `POST /api/kv/user-provider` - 保存供應商偏好
6. `POST /api/kv/user-provider/get` - 獲取供應商偏好
7. `GET /api/kv/user-lyrics` - 獲取所有用戶歌詞
8. `GET /api/kv/user-providers` - 獲取所有供應商偏好
9. `GET /api/kv/get-time-offsets` - 獲取時間偏移
10. `DELETE /api/kv/clear-all` - 清除雲端數據
11. `POST /api/kv/batch-save-lyrics` - 批量保存歌詞
12. `POST /api/kv/sync-all` - 同步所有數據
13. `GET /api/player/queue` - 獲取播放隊列
14. `PUT /api/player/transfer` - 轉移播放設備
15. `GET /api/kv/get-all-lyrics` - 獲取所有歌詞（替代路徑）

### 修改的文件

- `api/index.js` - 添加了所有新的 API 路由
- `api/storage-facade.js` - 添加了 `saveUserProvider()` 和 `getUserProvider()` 方法

## 部署步驟

### 1. 準備工作

確保你的專案目錄包含以下文件：
```
Spotify/
├── api/
│   ├── index.js (已更新)
│   ├── storage-facade.js (已更新)
│   ├── kv-storage.js
│   └── storage-enhanced.js
├── public/
│   └── ... (前端文件)
├── vercel.json
├── package.json
└── .env (本地測試用，不要上傳到 Vercel)
```

### 2. 安裝 Vercel CLI（如果還沒有）

```bash
npm install -g vercel
```

### 3. 登入 Vercel

```bash
vercel login
```

### 4. 部署到 Vercel

```bash
# 首次部署
vercel

# 或部署到生產環境
vercel --prod
```

### 5. 配置環境變數

在 Vercel Dashboard 中配置以下環境變數：

#### 必需的環境變數

前往 [Vercel Dashboard](https://vercel.com/dashboard) → 選擇你的專案 → Settings → Environment Variables

添加以下變數：

```
SPOTIFY_CLIENT_ID=你的_Spotify_Client_ID
SPOTIFY_CLIENT_SECRET=你的_Spotify_Client_Secret
REDIRECT_URI=https://你的專案名稱.vercel.app/callback
```

#### 可選的環境變數（推薦）

如果使用 Vercel KV Storage：

1. 在 Vercel Dashboard 中創建 KV Storage：
   - 前往 Storage 標籤
   - 點擊 "Create Database"
   - 選擇 "KV"
   - 連接到你的專案

2. Vercel 會自動添加以下環境變數：
   ```
   KV_REST_API_URL=...
   KV_REST_API_TOKEN=...
   KV_REST_API_READ_ONLY_TOKEN=...
   ```

如果不使用 KV Storage，系統將使用內存存儲（重啟後數據會丟失）。

### 6. 驗證部署

部署完成後：

1. 訪問你的 Vercel 應用 URL
2. 打開瀏覽器開發者工具（F12）
3. 切換到 Console 標籤
4. 登入 Spotify
5. 檢查是否有 404 錯誤

應該不再看到以下錯誤：
- `/api/kv/user-lyrics` 404
- `/api/extract-colors` 404
- `/api/library/check/...` 404
- `/api/kv/user-provider/get` 404
- `/api/kv/all-lyrics` 500

### 7. 檢查日誌

如果仍有問題，查看 Vercel 函數日誌：

```bash
vercel logs <deployment-url>
```

或在 Vercel Dashboard 中：
- Functions 標籤
- 選擇 `/api/index.js`
- 查看即時日誌

## 常見問題

### Q1: `/api/kv/all-lyrics` 仍然返回 500

**原因**: KV Storage 未正確配置或連接失敗

**解決方案**:
1. 確認已在 Vercel Dashboard 中創建並連接 KV Storage
2. 檢查環境變數 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN` 是否正確
3. 查看 Vercel 函數日誌以獲取詳細錯誤信息

### Q2: 顏色提取返回預設顏色

**原因**: 當前實現返回預設的 Spotify 風格顏色

**解決方案**:
如需真正的顏色提取，需要安裝額外的庫：
```bash
npm install color-thief-node
```

然後修改 `api/index.js` 中的 `extractDominantColors()` 函數。

### Q3: 某些 API 返回 401

**原因**: 用戶未登入或 Session 過期

**解決方案**:
1. 重新登入 Spotify
2. 檢查 `SPOTIFY_CLIENT_ID` 和 `SPOTIFY_CLIENT_SECRET` 是否正確
3. 確認 `REDIRECT_URI` 與 Spotify Developer Dashboard 中配置的一致

### Q4: 本地測試正常，但 Vercel 上出錯

**原因**: 環境變數未配置或 KV Storage 未連接

**解決方案**:
1. 檢查 Vercel Dashboard 中的環境變數配置
2. 確認 KV Storage 已正確連接
3. 查看 Vercel 函數日誌

## 本地測試

在部署前，可以在本地測試：

```bash
# 安裝依賴
npm install

# 創建 .env 文件並填入必要的環境變數
cp .env.example .env
# 編輯 .env 文件

# 啟動服務器
npm start

# 或使用 nodemon 進行開發
npm run dev
```

然後訪問 `http://localhost:3000` 測試功能。

## 性能優化建議

1. **啟用 Vercel KV Storage**: 提供持久化存儲和更好的性能
2. **配置 CDN 緩存**: 在 `vercel.json` 中添加緩存規則
3. **使用 Edge Functions**: 對於簡單的 API 端點，可以考慮使用 Edge Functions
4. **監控函數執行時間**: 確保不超過 Vercel 的限制（Hobby 計劃為 10 秒）

## 安全建議

1. **不要提交 `.env` 文件到 Git**: 已添加到 `.gitignore`
2. **定期旋轉 Spotify Client Secret**: 在 Spotify Developer Dashboard 中更新
3. **啟用 CORS 限制**: 只允許你的域名訪問 API
4. **添加速率限制**: 防止 API 濫用

## 支援

如有問題，請查看：
- Vercel 文檔: https://vercel.com/docs
- Spotify Web API 文檔: https://developer.spotify.com/documentation/web-api
- 專案 Issues: https://github.com/your-repo/issues
