# Spotify 403 Forbidden 錯誤修復指南

## 🔍 問題現象

```
Access forbidden - check Spotify Premium status or scopes
Queue API failed (non-critical): Request failed with status code 403
獲取 Spotify User ID 失敗：Request failed with status code 403
Error in /api/current-track: {
  status: 403,
  statusText: 'Forbidden',
  message: 'The user is not registered for this application...'
}
```

## ⚠️ 可能原因

### 1. Spotify 帳號不是 Premium（最常見）
**Queue API** 和部分 **Player API** 僅限 Spotify Premium 用戶使用。

### 2. Access Token 過期或無效
- Token 已過期且 refresh token 也失效
- Token 被撤銷

### 3. Scopes 不足
- 用戶使用舊的 scopes 授權，缺少必要權限
- 需要重新授權

### 4. Spotify Dashboard 設定問題
- Redirect URI 未正確配置
- Client ID/Secret 錯誤

---

## 🛠️ 解決方案

### 方案一：使用診斷工具（推薦）

我已創建了一個診斷工具 `diagnose-spotify-auth.js`

**步驟：**

1. **執行診斷工具**
   ```bash
   node diagnose-spotify-auth.js
   ```

2. **點擊生成的授權 URL**
   - 會打開 Spotify 授權頁面
   - 登入你的 Spotify 帳號
   - 同意授權

3. **複製 Redirect URL 中的 code 參數**
   - 授權後會被重定向到：`https://live.cyss.us.eu.org/callback?code=AQDxxx...`
   - 複製 `code=` 後面的值

4. **測試 Token 交換和 API 呼叫**
   ```bash
   node diagnose-spotify-auth.js <你的 code>
   ```
   
   例如：
   ```bash
   node diagnose-spotify-auth.js AQDxxx...
   ```

5. **查看診斷結果**
   - 工具會測試所有相關的 Spotify API
   - 顯示你的帳號類型（Premium 或 Free）
   - 指出哪些 API 呼叫失敗及原因

---

### 方案二：手動重新授權

1. **清除瀏覽器快取**
   - 清除 cookie 和 localStorage
   - 或開啟無痕模式

2. **訪問授權 URL**
   ```
   https://accounts.spotify.com/authorize?response_type=code&client_id=YOUR_CLIENT_ID&scope=user-read-currently-playing%20user-read-playback-state%20user-modify-playback-state%20user-read-playback-position%20user-read-private%20user-library-modify%20user-library-read%20playlist-read-private%20playlist-read-collaborative%20streaming&redirect_uri=https://live.cyss.us.eu.org/callback
   ```
   （將 `YOUR_CLIENT_ID` 替換為你的實際 Client ID）

3. **重新登入並授權**

4. **測試應用是否正常運作**

---

### 方案三：檢查 Spotify Dashboard 設定

1. **訪問 [Spotify Dashboard](https://developer.spotify.com/dashboard)**

2. **選擇你的應用**

3. **檢查 Redirect URIs**
   - 確保包含：`https://live.cyss.us.eu.org/callback`
   - 確保包含：`http://localhost:3000/callback`（如果用本地測試）

4. **檢查 Client ID 和 Secret**
   - 確認 `.env` 檔案中的值與 Dashboard 一致

---

### 方案四：如果是 Free 帳號

如果你的 Spotify 帳號是 **Free** 而非 Premium：

#### 選項 A：升級到 Premium
- 這是唯一能使用完整功能的方法

#### 選項 B：修改程式碼跳過 Premium 功能
修改 `server.js`，讓 Queue API 失敗時不影響主要功能：

```javascript
// 在 /api/current-track 中，將 queuePromise 設為永遠返回 null
let queuePromise = Promise.resolve(null);
// 而不是呼叫实际的 Queue API
```

但這樣會失去佇列顯示功能。

---

## 📊 診斷工具輸出解讀

### ✅ 正常輸出
```
✅ 獲取用戶資料 (/v1/me)
   🎯 帳號類型：Premium
✅ 獲取播放器狀態 (/v1/me/player)
✅ 獲取播放佇列 (/v1/me/player/queue)
✅ 獲取設備列表 (/v1/me/player/devices)
```

### ❌ Free 帳號輸出
```
✅ 獲取用戶資料 (/v1/me)
   ⚠️ 帳號類型：free (某些功能可能受限)
❌ 獲取播放器狀態 (/v1/me/player) - 403 Forbidden
   💬 Player API requires Premium
❌ 獲取播放佇列 (/v1/me/player/queue) - 403 Forbidden
   ⚠️ 這個 API 需要 Spotify Premium
```

### ❌ Token 失效輸出
```
❌ 獲取用戶資料 (/v1/me) - 401 Unauthorized (Token 可能過期)
❌ 獲取播放器狀態 (/v1/me/player) - 401 Unauthorized
```
**解決：** 重新授權獲取新 token

---

## 🔧 額外修復：清除伺服器端快取

如果重新授權後仍有問題，清除伺服器端的 session 快取：

1. **重啟伺服器**
   ```bash
   # 停止當前伺服器（Ctrl+C）
   # 重新啟動
   npm start
   ```

2. **或添加清除端點**（可選）
   在 `server.js` 中添加：
   ```javascript
   app.get('/api/clear-cache', async (req, res) => {
       const sessionId = req.headers['x-session-id'];
       if (sessionId) {
           userSessions.delete(sessionId);
           console.log(`🗑️ Cleared cache for session: ${sessionId}`);
           res.json({ success: true, message: 'Cache cleared' });
       } else {
           res.status(400).json({ error: 'No session ID provided' });
       }
   });
   ```

---

## 📞 仍然無法解決？

請提供以下資訊：

1. **診斷工具的完整輸出**
2. **你的 Spotify 帳號類型**（Premium 或 Free）
3. **錯誤發生的時間點**
   - 剛開始使用時？
   - 使用一段時間後？
   - 重新部署後？
4. **是否曾成功運作過**

---

## 📝 預防措施

1. **定期检查 Token 狀態**
   - 系統已包含自動 refresh token 機制
   - 確保 refresh token 被正確保存

2. **使用 Premium 帳號**
   - 這是使用完整 Spotify Web API 的必要條件

3. **正確配置 Redirect URI**
   - 確保 Dashboard 和 `.env` 中的 URI 一致

4. **監控錯誤日誌**
   - 注意 401 和 403 錯誤
   - 及時重新授權

---

## 🔗 相關資源

- [Spotify Web API 文件](https://developer.spotify.com/documentation/web-api)
- [Spotify 授權指南](https://developer.spotify.com/documentation/general/guides/authorization)
- [Player API 限制](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
