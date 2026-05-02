# API 路由修復總結

## 已添加的 API 路由

以下 API 路由已添加到 `api/index.js` 以解決 404 錯誤：

### 1. 顏色提取端點
- **路徑**: `POST /api/extract-colors`
- **功能**: 從專輯封面提取主要顏色
- **請求體**: `{ "imageUrl": "https://..." }`
- **響應**: `{ "success": true, "colors": { "dominant": "#...", ... } }`

### 2. 音樂庫檢查端點
- **路徑**: `GET /api/library/check/:trackId`
- **功能**: 檢查歌曲是否在用戶的喜歡列表中
- **響應**: `{ "isLiked": boolean, "trackId": string }`

### 3. 添加到喜歡列表
- **路徑**: `POST /api/library/add`
- **功能**: 將歌曲添加到用戶的喜歡列表
- **請求體**: `{ "trackId": "..." }`
- **響應**: `{ "success": true, "trackId": "..." }`

### 4. 從喜歡列表移除
- **路徑**: `POST /api/library/remove`
- **功能**: 從用戶的喜歡列表移除歌曲
- **請求體**: `{ "trackId": "..." }`
- **響應**: `{ "success": true, "trackId": "..." }`

### 5. 用戶供應商偏好保存
- **路徑**: `POST /api/kv/user-provider`
- **功能**: 保存用戶對歌詞供應商的偏好設置
- **請求體**: `{ "trackInfo": {...}, "provider": "...", "settings": {...} }`
- **響應**: `{ "success": true }`

### 6. 用戶供應商偏好獲取
- **路徑**: `POST /api/kv/user-provider/get`
- **功能**: 獲取用戶對歌詞供應商的偏好設置
- **請求體**: `{ "id": "trackId" }` 或 `{ "trackInfo": {...} }`
- **響應**: `{ "success": true, "data": {...} }`

### 7. 獲取所有用戶歌詞 (GET)
- **路徑**: `GET /api/kv/user-lyrics`
- **功能**: 獲取當前用戶的所有自定義歌詞（用於刷新 localStorage）
- **響應**: `{ "success": true, "data": [...] }`

### 8. 獲取所有用戶供應商偏好 (GET)
- **路徑**: `GET /api/kv/user-providers`
- **功能**: 獲取當前用戶的所有供應商偏好（用於刷新 localStorage）
- **響應**: `{ "success": true, "data": [...] }`

### 9. 獲取所有時間偏移
- **路徑**: `GET /api/kv/get-time-offsets`
- **功能**: 獲取當前用戶的所有時間偏移設置
- **響應**: `{ "success": true, "offsets": {} }`

### 10. 清除所有雲端數據
- **路徑**: `DELETE /api/kv/clear-all`
- **功能**: 清除用戶的所有 KV 數據
- **響應**: `{ "success": true, "message": "All cloud data cleared" }`

### 11. 批量保存歌詞
- **路徑**: `POST /api/kv/batch-save-lyrics`
- **功能**: 批量保存多個歌詞到雲端
- **請求體**: `{ "lyrics": [{ trackInfo, lyrics, lyricsType, source }, ...] }`
- **響應**: `{ "success": true, "saved": number, "total": number }`

### 12. 同步所有數據
- **路徑**: `POST /api/kv/sync-all`
- **功能**: 同步歌詞、時間偏移和供應商偏好到雲端
- **請求體**: `{ "lyrics": [...], "timeAdjustments": {}, "providers": {} }`
- **響應**: `{ "success": true, "summary": { synced, failed }, "items": [], "errors": [] }`

### 13. 獲取播放隊列
- **路徑**: `GET /api/player/queue`
- **功能**: 獲取 Spotify 播放隊列中的下一首歌曲
- **響應**: `{ "nextTrack": { id, name, artist, image } | null }`

### 14. 轉移播放設備
- **路徑**: `PUT /api/player/transfer`
- **功能**: 將播放轉移到另一個設備
- **請求體**: `{ "device_ids": ["..."], "play": true }`
- **響應**: `{ "success": true }`

### 15. 獲取所有歌詞 (替代路徑)
- **路徑**: `GET /api/kv/get-all-lyrics`
- **功能**: 獲取當前用戶的所有歌詞（與 `/api/kv/all-lyrics` 相同）
- **響應**: `{ "success": true, "data": [...], "count": number }`

## 已修改的文件

1. **api/index.js** - 添加了上述所有 API 路由
2. **api/storage-facade.js** - 添加了 `saveUserProvider()` 和 `getUserProvider()` 方法

## Vercel 部署檢查清單

在 Vercel 上部署前，請確保已配置以下環境變數：

### 必需的環境變數
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=https://your-domain.vercel.app/callback
```

### Vercel KV Storage (可選但推薦)
```
KV_REST_API_URL=your_kv_rest_api_url
KV_REST_API_TOKEN=your_kv_rest_api_token
```

如果沒有配置 KV Storage，系統將使用內存存儲（重啟後數據會丟失）。

## 測試步驟

1. 本地測試：
   ```bash
   npm start
   # 然後運行測試腳本
   node test-api-routes.js
   ```

2. 部署到 Vercel：
   ```bash
   vercel --prod
   ```

3. 在 Vercel Dashboard 中配置環境變數

4. 訪問應用並檢查瀏覽器控制台，確認沒有 404 錯誤

## 已知問題

1. `/api/extract-colors` 目前返回預設顏色，實際的顏色提取需要安裝額外的庫（如 `color-thief-node`）

2. `/api/kv/all-lyrics` 可能返回 500 錯誤，如果 KV Storage 未正確配置或連接失敗

3. 某些 API 需要有效的 Spotify Session，否則會返回 401 錯誤

## 後續改進建議

1. 實現真正的顏色提取功能
2. 添加更完善的錯誤處理和日誌記錄
3. 為所有 API 端點添加速率限制
4. 添加 API 文檔（Swagger/OpenAPI）
