# 自動錯誤日誌系統使用說明

## 🔍 功能概述

自動錯誤日誌系統會監控所有的 `console.log`、`console.error`、`console.warn` 和 `console.info` 訊息。當偵測到包含錯誤關鍵字的訊息時，會自動下載包含所有日誌的完整日誌檔案，方便開發者分析問題。

## ✨ 主要功能

### 1. 自動錯誤偵測
- 監控所有 console 輸出
- 自動偵測錯誤關鍵字：`錯誤`、`失敗`、`異常`、`error`、`fail`、`exception`、`timeout`、`❌`、`⚠️`
- 偵測到錯誤後 2 秒自動下載日誌檔

### 2. 完整日誌記錄
- 記錄所有 console 訊息（最多1000條）
- 包含時間戳（台北時區）
- 記錄日誌級別（LOG/ERROR/WARN/INFO）
- 包含瀏覽器資訊和當前網址

### 3. 手動控制
- 左下角的「📥 下載日誌」按鈕可手動下載
- 提供全域函數進行控制

## 🚀 安裝和使用

### 自動安裝
系統已自動整合到 `index.html` 中，會在頁面載入時自動啟動。

### 手動控制函數
```javascript
// 手動下載日誌檔
downloadLogs();

// 清除所有日誌
clearLogs();

// 查看日誌統計
getLogStats();

// 訪問日誌系統實例
window.autoErrorLogger
```

## 📁 日誌檔案格式

下載的日誌檔案命名格式：
```
spotify_lyrics_error_log_YYYY-MM-DD_HH-MM-SS-MS_觸發方式.txt
```

例如：
```
spotify_lyrics_error_log_2024-01-15_14-30-25-123_auto.txt
spotify_lyrics_error_log_2024-01-15_14-35-10-456_manual.txt
```

## 📄 日誌檔案內容結構

```
================================================================================
Spotify Lyrics Player - 自動錯誤日誌
================================================================================
生成時間: 2024-01-15 14:30:25.123
瀏覽器: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...
網址: http://localhost:3000/
總日誌條數: 45
================================================================================

[2024-01-15 14:29:15.001] [LOG] 🌐 环境检测: {...}
[2024-01-15 14:29:16.002] [ERROR] ❌ Spotify API 錯誤: 429 Too Many Requests
[2024-01-15 14:29:17.003] [WARN] 🚫 API 速率限制，5 秒後重試 (第1次)
...

================================================================================
日誌結束
================================================================================
```

## 🔧 觸發條件

### 智能錯誤檢測機制

系統採用多層級檢測機制，避免誤報：

#### **嚴重錯誤觸發條件**
- 連線錯誤：`連線錯誤`、`connection error`、`network error`
- API失敗：`請求失敗`、`載入失敗`、`api error`、`server error`
- 認證問題：`認證失敗`、`auth failed`、`token invalid`
- 系統異常：`exception`、`crash`、`fatal error`
- HTTP錯誤：`500`、`502`、`503`、`504`

#### **智能排除機制**
以下情況不會觸發自動下載（視為正常警告）：
- 狀態檢查：`checkAuthStatus`、`沒有找到 sessionId`
- 數據缺失：`無下一首數據`、`隊列為空`、`no data`
- 正常跳過：`跳過請求`、`skip`

#### **重複檢測防護**
- 5分鐘內相同錯誤不會重複觸發
- 錯誤嚴重程度自動分級：一般/重要/嚴重

### 觸發示例
```javascript
// 以下訊息會觸發自動下載
console.error('❌ 載入歌詞失敗');
console.log('API 呼叫錯誤: 網路連線逾時');
console.warn('🚫 認證異常');
console.log('Spotify API error: 429 Too Many Requests');
```

## 🎯 使用場景

### 1. 開發調試
- 自動捕捉開發過程中的錯誤
- 提供完整的錯誤上下文
- 無需手動記錄錯誤資訊

### 2. 生產環境監控
- 自動收集使用者遇到的錯誤
- 提供詳細的錯誤發生時間和環境資訊
- 便於遠程問題診斷

### 3. 問題分析
- 完整的操作序列記錄
- 錯誤發生前後的系統狀態
- 便於重現和修復問題

## ⚙️ 配置選項

可以通過修改 `auto-error-logger.js` 來自定義配置：

```javascript
// 在 constructor 中修改這些參數
this.maxLogs = 1000;           // 最多保存的日誌數量
this.downloadDelay = 2000;     // 錯誤偵測後的下載延遲（毫秒）
this.errorKeywords = [         // 錯誤關鍵字列表
    '錯誤', '失敗', '異常', 
    'error', 'fail', 'exception', 'timeout', 
    '❌', '⚠️'
];
```

## 📱 UI 元素

### 下載通知
錯誤偵測並下載日誌後，會在右上角顯示通知：
- 📥 圖示
- 檔案名稱
- 5秒後自動消失
- 可點擊 × 關閉

### 手動下載按鈕
左下角固定位置的綠色按鈕：
- 📥 下載日誌
- 圓角設計
- 懸浮效果
- 隨時可用

## ⚠️ 注意事項

1. **隱私保護**：日誌檔案僅在本地下載，不會上傳到任何服務器
2. **效能影響**：系統會攔截 console 方法，但影響微乎其微
3. **存儲限制**：僅保存最近 1000 條日誌，舊日誌會自動清除
4. **相容性**：支援所有現代瀏覽器，包括行動裝置

## 🔐 Session錯誤處理

### 特殊功能：跨頁面重載的錯誤捕捉
系統現在能夠處理session失效導致的頁面重載問題：

#### **實時監控機制**
- **網路請求監控**：自動攔截所有fetch和XMLHttpRequest，檢測401/403錯誤
- **URL變化監控**：監控認證相關的URL重定向
- **Session存儲監控**：實時監控localStorage中的session狀態變化

#### **頁面重載前保存**
- 監聽`beforeunload`、`pagehide`、`visibilitychange`事件
- 在頁面卸載前立即保存所有日誌到localStorage
- 設置錯誤標記，確保重載後能恢復錯誤狀態

#### **重載後恢復**
- 頁面重新載入時自動檢查是否有未處理的錯誤
- 如有錯誤標記，立即觸發日誌下載
- 自動恢復重載前的日誌記錄

### Session錯誤識別模式
```javascript
// 自動識別的session錯誤模式：
/session.*失效/i
/session.*過期/i  
/token.*expired/i
/401|403/
/unauthorized|forbidden/i
/認證過期|登入失效/
```

## 🛠️ 開發者說明

### 整合方式
系統透過多層攔截實現全面監控：

#### Console方法攔截
```javascript
// 保存原始方法
this.originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console)
};

// 攔截並記錄
console.log = function(...args) {
    self.addLog('log', args);
    self.originalConsole.log(...args);
};
```

#### 網路請求攔截
```javascript
// 攔截fetch請求
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(window, args);
    if (response.status === 401 || response.status === 403) {
        window.autoErrorLogger.addLog('ERROR', [
            `認證失敗: ${response.status} - ${args[0]}`
        ]);
    }
    return response;
};
```

### 持久化存儲
系統使用localStorage實現跨頁面的錯誤追蹤：
- `auto_error_logger_persistent`：存儲日誌和錯誤狀態
- `auto_error_logger_has_errors`：標記是否有未處理的錯誤

### 清理和銷毀
```javascript
// 停用系統並恢復原始方法
window.autoErrorLogger.destroy();
```

## 📞 支援

如有問題或建議，請檢查：
1. 瀏覽器 Console 中是否有初始化訊息
2. 左下角是否有下載按鈕
3. 測試頁面：`tmp_rovodev_test_error_logger.html`

---

**版本：** 1.0.0  
**最後更新：** 2024-01-15  
**相容性：** Chrome 80+, Firefox 75+, Safari 13+, Edge 80+