# 部署前檢查清單

## ✅ 代碼修改完成

- [x] 添加 `/api/extract-colors` POST 端點
- [x] 添加 `/api/library/check/:trackId` GET 端點
- [x] 添加 `/api/library/add` POST 端點
- [x] 添加 `/api/library/remove` POST 端點
- [x] 添加 `/api/kv/user-provider` POST 端點
- [x] 添加 `/api/kv/user-provider/get` POST 端點
- [x] 添加 `/api/kv/user-lyrics` GET 端點
- [x] 添加 `/api/kv/user-providers` GET 端點
- [x] 添加 `/api/kv/get-time-offsets` GET 端點
- [x] 添加 `/api/kv/clear-all` DELETE 端點
- [x] 添加 `/api/kv/batch-save-lyrics` POST 端點
- [x] 添加 `/api/kv/sync-all` POST 端點
- [x] 添加 `/api/player/queue` GET 端點
- [x] 添加 `/api/player/transfer` PUT 端點
- [x] 添加 `/api/kv/get-all-lyrics` GET 端點（已存在）
- [x] 改進 `/api/kv/all-lyrics` 錯誤處理
- [x] 在 `storage-facade.js` 中添加 `saveUserProvider()` 和 `getUserProvider()` 方法
- [x] 所有代碼通過語法檢查

## 📋 部署步驟

### 1. Git 提交（如果使用 Git）

```bash
git add api/index.js api/storage-facade.js
git commit -m "feat: 添加缺失的 API 路由以解決 404 錯誤

- 添加 15 個新的 API 端點
- 改進錯誤處理和日誌記錄
- 添加 storage-facade 方法支持"
git push
```

### 2. 部署到 Vercel

```bash
# 如果還沒有安裝 Vercel CLI
npm install -g vercel

# 登入
vercel login

# 部署到生產環境
vercel --prod
```

### 3. 配置環境變數

在 [Vercel Dashboard](https://vercel.com/dashboard) 中：

1. 選擇你的專案
2. 點擊 "Settings" → "Environment Variables"
3. 添加以下變數：

#### 必需
- `SPOTIFY_CLIENT_ID`: 你的 Spotify Client ID
- `SPOTIFY_CLIENT_SECRET`: 你的 Spotify Client Secret
- `REDIRECT_URI`: `https://你的專案名稱.vercel.app/callback`

#### 可選（推薦）
- `KV_REST_API_URL`: Vercel KV REST API URL（自動添加）
- `KV_REST_API_TOKEN`: Vercel KV REST API Token（自動添加）

### 4. 設置 Spotify Redirect URI

在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 中：

1. 選擇你的應用
2. 點擊 "Edit Settings"
3. 添加 Redirect URI: `https://你的專案名稱.vercel.app/api/callback`
4. 保存更改

### 5. 驗證部署

1. 訪問 `https://你的專案名稱.vercel.app`
2. 打開瀏覽器開發者工具（F12）
3. 切換到 Console 標籤
4. 登入 Spotify
5. 播放一首歌曲
6. 檢查控制台，確認沒有 404 錯誤

## 🔍 驗證清單

部署後，檢查以下功能是否正常：

- [ ] 用戶可以成功登入 Spotify
- [ ] 當前播放的歌曲信息正確顯示
- [ ] 歌詞可以正常載入
- [ ] 顏色提取功能正常（無 404 錯誤）
- [ ] 喜歡/取消喜歡歌曲功能正常
- [ ] 用戶歌詞偏好設置可以保存
- [ ] 時間偏移設置可以保存
- [ ] 播放隊列顯示正常
- [ ] 設備轉移功能正常
- [ ] 批量同步功能正常

## 🐛 問題排查

如果仍有問題：

### 檢查 Vercel 函數日誌

```bash
# 使用 CLI
vercel logs <your-deployment-url>

# 或在 Dashboard 中
# Functions → /api/index.js → Logs
```

### 常見錯誤及解決方案

1. **404 Not Found**
   - 確認 `vercel.json` 配置正確
   - 檢查路由是否已添加到 `api/index.js`
   - 確認部署已成功完成

2. **500 Internal Server Error**
   - 檢查 Vercel 函數日誌
   - 確認環境變數已正確配置
   - 檢查 KV Storage 連接狀態

3. **401 Unauthorized**
   - 確認 Spotify Client ID 和 Secret 正確
   - 檢查 Redirect URI 是否匹配
   - 確認用戶已登入 Spotify

4. **KV Storage 相關錯誤**
   - 確認已在 Vercel Dashboard 中創建 KV Storage
   - 檢查 KV 環境變數是否自動添加
   - 查看 KV Storage 連接日誌

## 📊 性能監控

部署後，建議監控以下指標：

1. **函數執行時間**: 確保不超過 30 秒限制
2. **記憶體使用量**: 確保不超過 Vercel 限制
3. **錯誤率**: 監控 4xx 和 5xx 錯誤
4. **響應時間**: 確保 API 響應迅速

可以在 Vercel Dashboard 的 "Analytics" 標籤中查看這些指標。

## 🎉 完成！

如果所有檢查都通過，恭喜你！你的應用已成功部署到 Vercel，所有 API 404 錯誤都已解決。

如有任何問題，請參考：
- `API_ROUTES_SUMMARY.md` - 完整的 API 路由文檔
- `DEPLOYMENT_GUIDE.md` - 詳細的部署指南
- Vercel 文檔: https://vercel.com/docs
