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

### 自動觸發條件
當 console 輸出包含以下任一關鍵字時會觸發自動下載：
- 中文：`錯誤`、`失敗`、`異常`
- 英文：`error`、`fail`、`exception`、`timeout`
- 表情符號：`❌`、`⚠️`

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

## 🛠️ 開發者說明

### 整合方式
系統透過攔截原生 console 方法實現：
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

### 清理和銷毀
```javascript
// 停用系統並恢復原始 console 方法
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