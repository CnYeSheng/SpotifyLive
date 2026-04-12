# 自動 Token/會話管理系統安裝指南

## 概述

這個增強的自動 Token/會話管理系統為您的 Spotify 歌詞播放器提供了以下功能：

### 🚀 主要特性

1. **自動 Token 刷新** - 在 Token 過期前自動刷新，無需用戶干預
2. **智能會話管理** - 自動保存和恢復會話，支持頁面刷新和重新訪問
3. **心跳檢測** - 定期檢查連接狀態，確保會話有效性
4. **錯誤重試** - 自動重試失敗的請求，提高穩定性
5. **可見性感知** - 當頁面重新可見時自動檢查和更新狀態
6. **調試工具** - 提供豐富的調試和監控功能

## 安裝步驟

### 1. 添加腳本到 HTML

在您的 `public/index.html` 文件中，在現有的 `script.js` 之前添加以下腳本：

```html
<!-- 在 </body> 標籤前添加 -->
<script src="enhanced-token-management.js"></script>
<script src="integrate-enhanced-auth.js"></script>
<script src="script.js"></script>
```

### 2. 複製文件

將以下文件複製到您的 `public/` 目錄：
- `enhanced-token-management.js`
- `integrate-enhanced-auth.js`

### 3. 重啟服務器

```bash
npm start
# 或
npm run enhanced
```

## 使用方法

### 自動功能

安裝後，系統將自動：

1. **保存會話** - 登入成功後自動保存會話信息
2. **恢復會話** - 頁面刷新或重新訪問時自動恢復
3. **刷新 Token** - 在過期前 5 分鐘自動刷新
4. **監控狀態** - 每 10 分鐘檢查一次連接狀態
5. **處理錯誤** - 自動重試失敗的請求

### 手動控制

您可以通過瀏覽器控制台使用以下調試命令：

```javascript
// 查看當前會話狀態
debugAuth.showStatus()

// 手動刷新 Token
debugAuth.refreshToken()

// 清除會話（用於測試）
debugAuth.clearSession()
```

## 配置選項

### Token 管理器設置

您可以在 `enhanced-token-management.js` 中調整以下參數：

```javascript
// 在 EnhancedTokenManager 構造函數中
this.maxRetries = 3;              // 最大重試次數
this.baseRetryDelay = 1000;       // 基礎重試延遲（毫秒）
```

### 自動刷新時機

```javascript
// Token 過期前多久開始刷新（默認 5 分鐘）
const refreshTime = this.tokenExpiresAt - Date.now() - 5 * 60 * 1000;

// 心跳檢測間隔（默認 10 分鐘）
this.heartbeatTimer = setInterval(() => {
    this.performHeartbeat();
}, 10 * 60 * 1000);
```

## 監控和調試

### 控制台日誌

系統會在控制台輸出詳細的日誌信息：

```
[2024-01-15 14:30:25] [TokenManager] ✅ 從存儲載入會話: 1a2b3c4d...
[2024-01-15 14:30:25] [TokenManager] ⏰ 自動刷新已設置，45 分鐘後執行
[2024-01-15 14:30:25] [TokenManager] 💓 心跳檢測已啟動 (每 10 分鐘)
```

### 會話狀態檢查

使用 `debugAuth.showStatus()` 查看詳細狀態：

```javascript
{
  "會話ID": "1a2b3c4d...",
  "會話狀態": "有效",
  "過期時間": "2024/1/15 下午3:30:25",
  "剩餘時間": "45 分鐘",
  "是否過期": "否"
}
```

## 故障排除

### 常見問題

1. **Token 自動刷新失敗**
   ```javascript
   // 檢查會話狀態
   debugAuth.showStatus()
   
   // 手動嘗試刷新
   debugAuth.refreshToken()
   ```

2. **會話無法恢復**
   ```javascript
   // 清除損壞的會話
   debugAuth.clearSession()
   
   // 重新登入
   window.location.href = '/api/auth'
   ```

3. **心跳檢測失敗**
   - 檢查網絡連接
   - 查看控制台錯誤信息
   - 確認服務器正常運行

### 調試模式

啟用詳細日誌：

```javascript
// 在控制台中設置
localStorage.setItem('debug_auth', 'true')
```

## 高級配置

### 自定義事件處理

```javascript
// 在 integrate-enhanced-auth.js 中自定義
this.tokenManager.onTokenRefreshed = () => {
    console.log('✅ Token 已自動刷新');
    // 添加自定義邏輯
    this.showSuccessMessage('🔄 連接已自動更新');
};

this.tokenManager.onAuthRequired = () => {
    console.log('🔑 需要重新認證');
    // 添加自定義邏輯
    this.showAuthSection();
};
```

### 自定義重試策略

```javascript
// 修改重試邏輯
async makeAuthenticatedRequest(url, options = {}) {
    // 自定義重試次數和延遲
    const maxRetries = 5;
    const baseDelay = 2000;
    
    // ... 重試邏輯
}
```

## 性能優化

### 減少 API 調用

1. **智能輪詢** - 系統會根據播放狀態調整檢查頻率
2. **批量請求** - 盡可能合併多個 API 請求
3. **緩存機制** - 避免重複的會話檢查

### 內存管理

```javascript
// 頁面卸載時清理資源
window.addEventListener('beforeunload', () => {
    if (window.spotifyPlayer) {
        window.spotifyPlayer.destroy();
    }
});
```

## 安全考慮

1. **Token 存儲** - 使用 localStorage 安全存儲會話信息
2. **自動清理** - 過期會話自動清除
3. **錯誤處理** - 敏感信息不會在錯誤中暴露

## 更新日誌

### v1.0.0
- 初始版本
- 基本的自動 Token 刷新功能
- 會話管理和恢復
- 心跳檢測機制

### 未來計劃
- [ ] 支持多個會話
- [ ] 更智能的重試策略
- [ ] 離線模式支持
- [ ] 更詳細的分析和監控

## 支持

如果您遇到問題或有建議，請：

1. 檢查控制台日誌
2. 使用調試工具診斷
3. 查看本文檔的故障排除部分

---

**注意**: 這個系統與現有的播放器完全兼容，不會影響現有功能，只是增強了認證和會話管理的穩定性。