# Vercel KV 設置指南

本指南將幫助您為 Spotify Lyrics Player 配置 Vercel KV 存儲，實現用戶數據的雲端同步。

## 什麼是 Vercel KV？

Vercel KV 是一個無服務器的 Redis 兼容的鍵值數據庫，提供：
- 快速的數據讀寫
- 自動擴容
- 全球分佈
- 與 Vercel 項目無縫集成

## 設置步驟

### 1. 創建 Vercel KV 數據庫

1. 登錄 [Vercel Dashboard](https://vercel.com/dashboard)
2. 點擊頂部的 "Storage" 選項卡
3. 點擊 "Create Database"
4. 選擇 "KV" 數據庫類型
5. 輸入數據庫名稱（例如：`spotify-lyrics-kv`）
6. 選擇地區（建議選擇靠近用戶的地區）
7. 點擊 "Create"

### 2. 獲取環境變量

創建數據庫後，您將看到連接信息：

```bash
# 複制這些環境變量到您的 .env 文件
KV_REST_API_URL=https://your-kv-db.upstash.io
KV_REST_API_TOKEN=your_rest_api_token
KV_REST_API_READ_ONLY_TOKEN=your_read_only_token
```

### 3. 配置 Vercel 項目

#### 方法 A: 通過 Vercel Dashboard

1. 進入您的項目設置
2. 點擊 "Environment Variables" 選項卡
3. 添加以下環境變量：
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

#### 方法 B: 使用 Vercel CLI

```bash
# 連接數據庫到項目
vercel env pull .env.local

# 或手動添加
vercel env add KV_REST_API_URL
vercel env add KV_REST_API_TOKEN
vercel env add KV_REST_API_READ_ONLY_TOKEN
```

### 4. 本地開發設置

創建 `.env.local` 文件並添加 KV 環境變量：

```bash
# .env.local
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=http://localhost:3000/callback
PORT=3000

# Vercel KV
KV_REST_API_URL=https://your-kv-db.upstash.io
KV_REST_API_TOKEN=your_rest_api_token
KV_REST_API_READ_ONLY_TOKEN=your_read_only_token
```

### 5. 部署更新

配置完成後，重新部署您的項目：

```bash
# 如果使用 Git 部署，提交並推送
git add .
git commit -m "Add Vercel KV storage"
git push

# 或使用 Vercel CLI
vercel --prod
```

## 功能說明

### 🔄 雙存儲策略 (KV + localStorage)

本系統採用創新的雙存儲架構，結合雲端和本地存儲的優勢：

#### 💡 設計理念
- **localStorage**: 快速響應、即時可用、離線支持
- **Vercel KV**: 雲端同步、跨設備共享、數據持久化
- **智能同步**: 自動檢測數據更新，保持兩端一致性

#### 🔀 工作流程
1. **保存數據**: 同時寫入 KV 和 localStorage
2. **讀取數據**: 優先從 localStorage 快速響應
3. **背景同步**: 自動比較和同步兩端數據
4. **衝突解決**: 以最新修改時間為準

### 🚀 智能同步機制

#### 即時響應
- 優先從 localStorage 獲取數據（0延遲）
- 用戶操作立即生效，無需等待網絡請求

#### 背景同步
- 自動檢查 KV 中的最新數據
- 如果 KV 數據更新，同步到 localStorage
- 如果本地數據更新，背景推送到 KV

#### 數據一致性
```javascript
// 數據比較邏輯
if (kvData.lastUsed > localData.lastUsed) {
    // KV 數據較新，更新本地
    updateLocalStorage(kvData);
} else if (localData.lastUsed > kvData.lastUsed) {
    // 本地數據較新，同步到 KV
    syncToKVBackground(localData);
}
```

### 🛡️ 容錯機制

#### 多重備份保護
- **主備份**: Vercel KV 雲端存儲
- **本地備份**: localStorage 實時同步
- **故障轉移**: 任一存儲失敗不影響功能

#### 自動降級
- KV 不可用時：完全依賴 localStorage
- localStorage 異常時：僅使用 KV 存儲
- 網絡問題時：本地優先，背景重試

### 📊 數據同步狀態

系統提供多種同步狀態指示：
- ✅ **已同步**: KV 和 localStorage 數據一致
- 🔄 **同步中**: 正在後台同步數據
- ⚠️ **部分同步**: 僅一個存儲成功
- ❌ **同步失敗**: 兩個存儲都失敗

### 用戶數據類型

KV 存儲管理以下用戶數據：

1. **自定義歌詞** (`custom_lyrics`)
   - 用戶手動添加的歌詞
   - 編輯過的歌詞
   - 時間軸調整

2. **供應商偏好** (`provider_pref`)
   - 用戶選擇的特定歌詞供應商
   - 按歌曲記住的偏好設置

## API 端點

配置完成後，以下 API 端點將可用：

```javascript
// 檢查 KV 狀態
GET /api/kv/status

// 用戶自定義歌詞
POST /api/kv/user-lyrics
GET /api/kv/user-lyrics/:artist/:title
GET /api/kv/user-lyrics
DELETE /api/kv/user-lyrics/:trackKey

// 用戶供應商偏好
POST /api/kv/user-provider
GET /api/kv/user-provider/:artist/:title
GET /api/kv/user-providers
DELETE /api/kv/user-provider/:trackKey

// 數據管理
POST /api/kv/migrate
DELETE /api/kv/user-data
```

### 前端集成

### 檢查存儲狀態

```javascript
// 檢查存儲狀態 (增強版)
const status = window.kvStorageManager.getStorageStatus();
console.log('Storage Status:', status);

// 輸出示例:
{
    kvAvailable: true,
    userKey: "user_abc123",
    fallbackEnabled: true,
    hasLocalData: true,
    stats: {
        customLyricsCount: 15,
        providerPrefsCount: 8,
        totalLocalStorageSize: 2048,
        oldestEntry: {...},
        newestEntry: {...}
    },
    version: "2.0.0"
}
```

### 存儲模式控制

```javascript
// 設置存儲模式
window.kvStorageManager.setStorageMode('hybrid');    // 混合模式 (推薦)
window.kvStorageManager.setStorageMode('kv-only');   // 僅 KV 模式
window.kvStorageManager.setStorageMode('local-only'); // 僅本地模式
```

### 數據同步操作

```javascript
// 批量同步本地數據到 KV
const syncResult = await window.kvStorageManager.syncAllLocalDataToKV();
console.log(`同步完成: ${syncResult.syncedCount} 成功, ${syncResult.errorCount} 失敗`);

// 從 KV 刷新本地數據
const refreshed = await window.kvStorageManager.refreshFromKV();

// 檢測數據衝突
const conflicts = await window.kvStorageManager.resolveDataConflicts();
if (conflicts.length > 0) {
    console.log('發現數據衝突:', conflicts);
}
```

### 數據維護

```javascript
// 清理舊數據 (保留30天)
const cleaned = window.kvStorageManager.cleanupOldLocalData(30);
console.log(`清理了 ${cleaned} 條舊數據`);

// 導出用戶數據
window.kvStorageManager.exportUserData();

// 查看存儲統計
window.kvStorageManager.showStats();
```

### 便捷方法

```javascript
// 快速操作方法
window.kvStorageManager.quickSync();   // 快速同步
window.kvStorageManager.quickClean();  // 快速清理
window.kvStorageManager.showStats();   // 顯示統計
```

## 監控和維護

### 查看數據庫使用情況

1. 在 Vercel Dashboard 中查看 KV 數據庫
2. 監控請求量和數據大小
3. 檢查錯誤日誌

### 數據結構

```javascript
// 用戶自定義歌詞
"custom_lyrics:user_abc123:trackKey" = {
    trackKey: "trackKey",
    userKey: "user_abc123",
    trackInfo: {...},
    lyrics: [...],
    lyricsType: "synced",
    source: {...},
    timestamp: 1234567890,
    lastUsed: 1234567890
}

// 用戶供應商偏好
"provider_pref:user_abc123:trackKey" = {
    trackKey: "trackKey",
    userKey: "user_abc123",
    trackInfo: {...},
    provider: "musixmatch",
    timestamp: 1234567890,
    lastUsed: 1234567890
}

// 用戶索引
"user_index:user_abc123:custom_lyrics" = ["trackKey1", "trackKey2", ...]
"user_index:user_abc123:provider_pref" = ["trackKey1", "trackKey2", ...]
```

## 故障排除

### 常見問題

1. **KV 不可用**
   - 檢查環境變量是否正確設置
   - 確認 KV 數據庫狀態正常
   - 查看 Vercel 函數日誌

2. **數據遷移失敗**
   - 檢查瀏覽器控制台錯誤
   - 確認網絡連接
   - 重試遷移操作

3. **用戶數據丟失**
   - 檢查用戶標識符是否一致
   - 確認數據是否存在於 KV 中
   - 查看 localStorage 備份

### 調試命令

```javascript
// 查看 KV 管理器狀態
console.log(window.kvStorageManager.getStorageStatus());

// 強制重新檢查 KV
await window.kvStorageManager.refreshKVStatus();

// 設置 fallback 模式
window.kvStorageManager.setFallbackMode(true);
```

## 安全性

- 用戶數據基於 IP 和 User-Agent 生成唯一標識符
- 不存儲個人敏感信息
- 支持數據清除和導出
- 遵循 GDPR 和隱私保護要求

## 限制

- Vercel KV 免費方案有使用限制
- 每月請求數限制
- 數據庫大小限制
- 建議監控使用量以避免超限

## 總結

配置 Vercel KV 後，用戶將享受到：
- 跨設備數據同步
- 更可靠的數據存儲
- 更好的用戶體驗
- 自動數據備份

如需更多幫助，請參考 [Vercel KV 官方文檔](https://vercel.com/docs/storage/vercel-kv)。