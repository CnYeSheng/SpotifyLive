# Spotify Lyrics Player - API 文檔

## 概述

本文檔描述了 Spotify Lyrics Player 的所有 API 端點。

**Base URL:** 
- 本地開發：`http://localhost:3000/api`
- Vercel 部署：`https://your-domain.vercel.app/api`

## 認證端點 (Authentication)

### 1. 啟動授權流程
```
GET /api/auth
```
重定向用戶到 Spotify 授權頁面。

**響應：** 302 重定向到 Spotify 授權頁面

---

### 2. 授權回調
```
GET /api/callback
```
Spotify 授權後的回調端點。

**查詢參數：**
- `code`: 授權碼
- `state`: Session ID

**響應：** 302 重定向到首頁，帶上 session cookie

---

### 3. 檢查認證狀態
```
GET /api/auth-status
```
檢查用戶是否已認證。

**響應：**
```json
{
  "authenticated": true,
  "sessionId": "abc123..."
}
```

---

### 4. 刷新 Token
```
POST /api/refresh-token
```
手動刷新訪問令牌。

**響應：**
```json
{
  "success": true
}
```

---

### 5. 強制重新登錄
```
GET /api/force-relogin
```
清除當前會話並重新啟動授權流程。

**響應：** 302 重定向到授權頁面

---

## 播放器端點 (Player)

### 6. 獲取當前播放曲目
```
GET /api/current-track
```
獲取當前正在播放的曲目詳情。

**Headers:**
- `X-Session-Id`: Session ID (可選)

**響應：**
```json
{
  "isPlaying": true,
  "name": "Song Name",
  "artist": "Artist Name",
  "album": "Album Name",
  "image": "https://...",
  "duration": 180000,
  "progress": 45000,
  "id": "track_id",
  "shuffle_state": false,
  "repeat_state": "off",
  "user_id": "user_id",
  "device": {
    "id": "device_id",
    "name": "Device Name",
    "type": "computer",
    "volume": 50
  },
  "queue": [],
  "lyricsOffset": 0,
  "manualLyrics": null
}
```

---

### 7. 獲取可用設備
```
GET /api/devices
```
獲取用戶所有可用的 Spotify 設備。

**響應：**
```json
{
  "devices": [
    {
      "id": "device_id",
      "name": "Device Name",
      "type": "computer",
      "is_active": true,
      "volume_percent": 50
    }
  ]
}
```

---

### 8. 播放/暫停切換
```
POST /api/playback/play-pause
```
切換播放/暫停狀態。

**響應：**
```json
{
  "success": true
}
```

---

### 9. 下一首
```
POST /api/playback/next
```
跳到下一首曲目。

**響應：**
```json
{
  "success": true
}
```

---

### 10. 上一首
```
POST /api/playback/previous
```
返回上一首曲目。

**響應：**
```json
{
  "success": true
}
```

---

### 11. 調整播放位置
```
POST /api/playback/seek
```
設置當前播放位置。

**請求體：**
```json
{
  "position_ms": 45000
}
```

**響應：**
```json
{
  "success": true
}
```

---

### 12. 設置音量
```
POST /api/playback/volume
```
設置播放器音量。

**請求體：**
```json
{
  "volume": 50
}
```

**響應：**
```json
{
  "success": true
}
```

---

### 13. 切換隨機播放
```
POST /api/playback/shuffle
```
切換隨機播放狀態。

**請求體：**
```json
{
  "state": true
}
```

**響應：**
```json
{
  "success": true
}
```

---

### 14. 設置循環模式
```
POST /api/playback/repeat
```
設置循環播放模式。

**請求體：**
```json
{
  "state": "off" // "off", "track", "context"
}
```

**響應：**
```json
{
  "success": true
}
```

---

## 歌詞控制端點 (Lyrics Control)

### 15. 設置歌詞偏移
```
POST /api/control/offset
```
為當前曲目設置歌詞時間偏移。

**請求體：**
```json
{
  "offset": 500,
  "trackId": "track_id"
}
```

**響應：**
```json
{
  "success": true
}
```

---

### 16. 設置手動歌詞
```
POST /api/control/manual-lyrics
```
為當前曲目設置自定義歌詞。

**請求體：**
```json
{
  "lyrics": "[00:00.00]Lyrics line 1\n[00:05.00]Lyrics line 2",
  "trackId": "track_id"
}
```

**響應：**
```json
{
  "success": true
}
```

---

### 17. 重置歌詞設置
```
POST /api/control/reset
```
重置當前曲目的歌詞設置。

**請求體：**
```json
{
  "trackId": "track_id"
}
```

**響應：**
```json
{
  "success": true
}
```

---

## 健康檢查 (Health Check)

### 18. 健康檢查端點
```
GET /api/health
```
檢查服務運行狀態，包含系統指標。

**響應：**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": "1h 30m 45s",
  "memory": {
    "heapUsed": 50,
    "heapTotal": 100,
    "rss": 120,
    "usagePercent": "45.67"
  },
  "requests": {
    "total": 1000,
    "failed": 5,
    "avgResponseTime": "120ms"
  }
}
```

---

### 19. 監控指標端點
```
GET /api/metrics
```
獲取詳細的系統監控指標。

**響應：**
```json
{
  "startTime": 1704067200000,
  "uptime": 5445,
  "uptimeFormatted": "1h 30m 45s",
  "requests": {
    "total": 1000,
    "successful": 995,
    "failed": 5,
    "avgResponseTime": 120.5
  },
  "memory": {
    "heapUsed": 50,
    "heapTotal": 100,
    "external": 5,
    "rss": 120,
    "usagePercent": "45.67"
  },
  "cpu": {
    "usage": "25.30"
  },
  "errors": {
    "total": 5,
    "byType": {
      "SPOTIFY_API_ERROR": 3,
      "NETWORK_ERROR": 2
    }
  },
  "alerts": {
    "triggered": 0,
    "lastAlert": null
  }
}
```

---

### 20. 日誌分析端點
```
GET /api/logs/analysis?range=1h
```
獲取日誌聚合分析結果。

**查詢參數：**
- `range`: 時間範圍 (`1h`, `6h`, `24h`, `7d`)，默認為 `1h`

**響應：**
```json
{
  "generatedAt": "2024-01-01T00:00:00.000Z",
  "timeRange": "1h",
  "totalLogs": 500,
  "byLevel": {
    "INFO": 450,
    "WARN": 40,
    "ERROR": 10
  },
  "errorRate": "2.00%",
  "topMessages": [
    { "message": "Spotify API rate limit", "count": 5 },
    { "message": "Network timeout", "count": 3 }
  ],
  "alerts": {
    "count": 2,
    "lastAlertTime": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## 錯誤響應

所有端點在出錯時會返回以下格式的響應：

```json
{
  "error": "Error message description"
}
```

**常見 HTTP 狀態碼：**
- `200`: 成功
- `401`: 未認證
- `403`: 禁止訪問
- `404`: 資源不存在
- `429`: 速率限制
- `500`: 服務器錯誤

---

## 速率限制

Spotify API 實施了速率限制：
- 全局限制：每分鐘 180 次請求
- 每 Session 限制：每分鐘 300 次請求

當觸發速率限制時，會返回 `429 Too Many Requests` 狀態碼，並在 `Retry-After` 頭中指定重試時間。

---

## 認證流程

1. 用戶訪問 `/api/auth`
2. 被重定向到 Spotify 授權頁面
3. 用戶同意授權後，被重定向回 `/api/callback?code=xxx&state=yyy`
4. 服務器交換 code 獲取 access token 和 refresh token
5. 創建 session 並設置 cookie
6. 後續請求自動攜帶 session cookie 或使用 `X-Session-Id` header
