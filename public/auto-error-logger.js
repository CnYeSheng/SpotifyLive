/**
 * 自動錯誤日誌系統
 * 當偵測到 console.log 中有錯誤訊息時，自動下載包含所有訊息的日誌檔
 */

class AutoErrorLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000; // 最多保存1000條日誌
        this.errorKeywords = [
            // 嚴重錯誤關鍵字
            '連線錯誤', '請求失敗', '載入失敗', '初始化失敗', '認證失敗', 
            'connection error', 'request failed', 'load failed', 'init failed', 'auth failed',
            'network error', 'api error', 'server error', 'timeout error',
            // Session相關錯誤
            'session.*失效', 'session.*過期', 'session.*invalid', 'token.*過期', 'token.*expired',
            '401', '403', 'unauthorized', 'forbidden', '認證過期', '登入失效',
            // 異常和崩潰
            'exception', 'crash', 'fatal', '嚴重錯誤', '致命錯誤',
            // HTTP錯誤碼（排除常見的認證相關）
            '500 ', '502 ', '503 ', '504 ', 'internal server error'
        ];
        
        // 新增：用戶可控制的自動下載設定
        this.autoDownloadEnabled = localStorage.getItem('auto_error_download_enabled') !== 'false'; // 預設為開啟
        
        // 不應觸發下載的關鍵字（警告級別）
        this.warningKeywords = [
            '無下一首數據', '獲取失敗', '隊列為空', '沒有找到', '跳過',
            'no data', 'not found', 'skip', 'empty queue', 'no session',
            '⚠️', '❌ 沒有找到', '❌ checkAuthStatus'
        ];
        
        this.isErrorDetected = false;
        this.downloadDelay = 1500; // 縮短延遲到1.5秒，確保在頁面重載前觸發
        this.downloadTimeout = null;
        this.recentErrors = []; // 記錄最近的錯誤，避免重複觸發
        this.persistentStorage = new Map(); // 持久化存儲，跨頁面重載保持
        
        // 綁定原始 console 方法
        this.originalConsole = {
            log: console.log.bind(console),
            error: console.error.bind(console),
            warn: console.warn.bind(console),
            info: console.info.bind(console)
        };
        
        this.init();
    }

    init() {
        // 首先恢復之前的日誌
        this.restorePersistentLogs();
        
        this.interceptConsoleMethods();
        this.addDownloadButton();
        this.setupBeforeUnloadHandler();
        
        console.log('🔍 自動錯誤日誌系統已啟動');
        
        // 立即開始session監控
        this.startSessionMonitoring();
        
        // 檢查是否有之前未處理的錯誤
        this.checkForPreviousErrors();
    }

    // 恢復持久化的日誌
    restorePersistentLogs() {
        try {
            const stored = localStorage.getItem('auto_error_logger_persistent');
            if (stored) {
                const data = JSON.parse(stored);
                this.logs = data.logs || [];
                this.recentErrors = data.recentErrors || [];
                
                // 清理超過10分鐘的數據
                const now = Date.now();
                this.logs = this.logs.filter(log => now - log.timestamp < 600000);
                this.recentErrors = this.recentErrors.filter(error => now - error.timestamp < 600000);
                
                if (this.logs.length > 0) {
                    console.log(`🔄 恢復 ${this.logs.length} 條歷史日誌`);
                }
            }
        } catch (error) {
            console.error('恢復歷史日誌失敗:', error);
            localStorage.removeItem('auto_error_logger_persistent');
        }
    }

    // 檢查之前是否有未處理的錯誤
    checkForPreviousErrors() {
        try {
            const errorFlag = localStorage.getItem('auto_error_logger_has_errors');
            if (errorFlag === 'true') {
                console.log('🚨 檢測到頁面重載前有錯誤，立即觸發下載');
                this.downloadLogs('reload_recovery', '重要');
                localStorage.removeItem('auto_error_logger_has_errors');
            }
        } catch (error) {
            console.error('檢查歷史錯誤失敗:', error);
        }
    }

    // 設置頁面卸載前的處理
    setupBeforeUnloadHandler() {
        // 監聽頁面卸載事件
        window.addEventListener('beforeunload', () => {
            this.saveLogsBeforeUnload();
        });

        // 監聽頁面隱藏事件（更可靠）
        window.addEventListener('pagehide', () => {
            this.saveLogsBeforeUnload();
        });

        // 監聽visibilitychange事件（作為備用）
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.saveLogsBeforeUnload();
            }
        });
    }

    // 頁面卸載前保存日誌
    saveLogsBeforeUnload() {
        try {
            // 保存當前日誌到localStorage
            const data = {
                logs: this.logs,
                recentErrors: this.recentErrors,
                timestamp: Date.now()
            };
            localStorage.setItem('auto_error_logger_persistent', JSON.stringify(data));
            
            // 如果有錯誤，設置標記
            if (this.recentErrors.length > 0) {
                localStorage.setItem('auto_error_logger_has_errors', 'true');
                console.log('💾 檢測到錯誤，已保存日誌狀態');
            }
        } catch (error) {
            console.error('保存日誌失敗:', error);
        }
    }

    // 開始session監控
    startSessionMonitoring() {
        // 監控URL變化（可能因為認證失敗重定向）
        this.monitorUrlChanges();
        
        // 監控網路請求錯誤
        this.monitorNetworkErrors();
        
        // 監控localStorage中的session狀態
        this.monitorSessionStorage();
        
        console.log('🔐 Session監控系統已啟動');
    }

    // 監控URL變化
    monitorUrlChanges() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            window.autoErrorLogger.checkUrlForAuth(args[2]);
            return originalPushState.apply(history, args);
        };
        
        history.replaceState = function(...args) {
            window.autoErrorLogger.checkUrlForAuth(args[2]);
            return originalReplaceState.apply(history, args);
        };
        
        window.addEventListener('popstate', () => {
            this.checkUrlForAuth(window.location.href);
        });
    }

    // 檢查URL是否包含認證相關資訊
    checkUrlForAuth(url) {
        if (url && (url.includes('/api/auth') || url.includes('auth=') || url.includes('error='))) {
            console.log(`🔍 檢測到認證相關URL變化: ${url}`);
            this.addLog('INFO', [`檢測到認證相關URL變化: ${url}`]);
        }
    }

    // 監控網路錯誤
    monitorNetworkErrors() {
        // 攔截fetch請求
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            try {
                const response = await originalFetch.apply(window, args);
                
                // 檢查認證相關的HTTP狀態碼
                if (response.status === 401 || response.status === 403) {
                    const url = args[0];
                    window.autoErrorLogger.addLog('ERROR', [
                        `網路請求認證失敗: ${response.status} ${response.statusText} - URL: ${url}`
                    ]);
                }
                
                return response;
            } catch (error) {
                window.autoErrorLogger.addLog('ERROR', [
                    `網路請求失敗: ${error.message} - URL: ${args[0]}`
                ]);
                throw error;
            }
        };

        // 監控XMLHttpRequest
        const originalXhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this.addEventListener('loadend', function() {
                if (this.status === 401 || this.status === 403) {
                    window.autoErrorLogger.addLog('ERROR', [
                        `XMLHttpRequest認證失敗: ${this.status} ${this.statusText} - URL: ${url}`
                    ]);
                }
            });
            
            return originalXhrOpen.apply(this, [method, url, ...args]);
        };
    }

    // 監控session存儲
    monitorSessionStorage() {
        // 定期檢查localStorage中的session狀態
        this.sessionCheckInterval = setInterval(() => {
            try {
                const sessionId = localStorage.getItem('spotify_session_id');
                
                if (!sessionId && this.lastKnownSessionId) {
                    // Session消失了
                    this.addLog('WARN', [
                        `Session ID 已消失 - 上一個已知ID: ${this.lastKnownSessionId.substring(0, 8)}...`
                    ]);
                }
                
                this.lastKnownSessionId = sessionId;
            } catch (error) {
                this.addLog('ERROR', [`監控session存儲失敗: ${error.message}`]);
            }
        }, 5000); // 每5秒檢查一次
        
        // 監控localStorage變化
        window.addEventListener('storage', (e) => {
            if (e.key === 'spotify_session_id') {
                if (e.oldValue && !e.newValue) {
                    this.addLog('ERROR', ['Session ID 被清除']);
                } else if (!e.oldValue && e.newValue) {
                    this.addLog('INFO', ['新的Session ID 已設置']);
                }
            }
        });
    }

    // 攔截 console 方法
    interceptConsoleMethods() {
        const self = this;
        
        ['log', 'error', 'warn', 'info'].forEach(method => {
            console[method] = function(...args) {
                // 記錄日誌
                self.addLog(method, args);
                
                // 呼叫原始方法
                self.originalConsole[method](...args);
            };
        });
    }

    // 添加日誌記錄
    addLog(level, args) {
        const timestamp = this.getFormattedTimestamp();
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            url: window.location.href,
            userAgent: navigator.userAgent
        };
        
        // 保存日誌
        this.logs.push(logEntry);
        
        // 限制日誌數量
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
        
        // 實時保存日誌到localStorage（每10條或遇到錯誤時）
        if (this.logs.length % 10 === 0 || level === 'ERROR' || this.containsSessionError(message)) {
            this.saveLogsToStorage();
        }
        
        // 檢查是否包含錯誤關鍵字
        this.checkForErrors(message);
        
        // 特殊處理session相關錯誤
        if (this.containsSessionError(message)) {
            this.handleSessionError(message);
        }
    }

    // 檢查錯誤關鍵字
    checkForErrors(message) {
        const messageStr = message.toLowerCase();
        const originalMessage = message;
        
        // 首先檢查是否為警告級別（不應觸發下載）
        const isWarning = this.warningKeywords.some(keyword => 
            originalMessage.includes(keyword) || messageStr.includes(keyword.toLowerCase())
        );
        
        if (isWarning) {
            return; // 警告級別，不觸發下載
        }
        
        // 檢查是否為真正的錯誤
        const hasError = this.errorKeywords.some(keyword => 
            messageStr.includes(keyword.toLowerCase())
        );
        
        // 額外的嚴重程度檢查
        const isSevereError = this.isSevereError(originalMessage);
        
        if ((hasError || isSevereError) && !this.isErrorDetected) {
            // 檢查是否為重複錯誤（5分鐘內相同錯誤不重複觸發）
            if (this.isDuplicateError(originalMessage)) {
                return;
            }
            
            this.isErrorDetected = true;
            this.recordError(originalMessage);
            this.scheduleAutoDownload();
        }
    }

    // 判斷是否為嚴重錯誤
    isSevereError(message) {
        // 檢查連續的錯誤模式
        const severePatterns = [
            /error.*failed/i,           // "error" 和 "failed" 同時出現
            /連線.*中斷/,                // 連線中斷
            /無法.*連接/,                // 無法連接
            /auth.*expired/i,           // 認證過期（但排除檢查狀態的）
            /token.*invalid/i,          // token無效
            /api.*unavailable/i,        // API不可用
            /server.*down/i             // 服務器故障
        ];
        
        // 排除正常的檢查和狀態更新
        const excludePatterns = [
            /checkAuthStatus/i,
            /顯示登入頁面/,
            /跳過.*請求/,
            /沒有找到.*sessionId/,
            /無下一首/
        ];
        
        // 如果匹配排除模式，則不是嚴重錯誤
        if (excludePatterns.some(pattern => pattern.test(message))) {
            return false;
        }
        
        // 檢查嚴重錯誤模式
        return severePatterns.some(pattern => pattern.test(message));
    }

    // 記錄錯誤
    recordError(message) {
        const now = Date.now();
        this.recentErrors.push({
            message: message,
            timestamp: now
        });
        
        // 清理5分鐘前的錯誤記錄
        this.recentErrors = this.recentErrors.filter(error => 
            now - error.timestamp < 300000 // 5分鐘 = 300000毫秒
        );
    }

    // 檢查是否為重複錯誤
    isDuplicateError(message) {
        const now = Date.now();
        const recentSimilar = this.recentErrors.filter(error => 
            now - error.timestamp < 300000 && // 5分鐘內
            this.isSimilarError(error.message, message)
        );
        
        return recentSimilar.length > 0;
    }

    // 判斷錯誤是否相似
    isSimilarError(error1, error2) {
        // 簡單的相似度判斷：去除時間戳後比較
        const clean1 = error1.replace(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/g, '').trim();
        const clean2 = error2.replace(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/g, '').trim();
        
        return clean1 === clean2;
    }

    // 檢測session相關錯誤
    containsSessionError(message) {
        const sessionErrorPatterns = [
            /session.*失效/i,
            /session.*過期/i,
            /session.*invalid/i,
            /token.*過期/i,
            /token.*expired/i,
            /401/,
            /403/,
            /unauthorized/i,
            /forbidden/i,
            /認證過期/,
            /登入失效/,
            /authentication.*failed/i,
            /access.*denied/i,
            /需要重新登入/
        ];
        
        return sessionErrorPatterns.some(pattern => pattern.test(message));
    }

    // 處理session錯誤
    handleSessionError(message) {
        console.warn('🚨 檢測到Session相關錯誤，準備立即保存日誌');
        
        // 立即標記有錯誤
        localStorage.setItem('auto_error_logger_has_errors', 'true');
        
        // 立即保存當前狀態
        this.saveLogsToStorage();
        
        // 記錄session錯誤
        this.recordError(`SESSION_ERROR: ${message}`);
        
        // 縮短下載延遲，立即觸發
        if (this.downloadTimeout) {
            clearTimeout(this.downloadTimeout);
        }
        
        console.warn('⚡ Session錯誤 - 立即觸發日誌下載');
        this.downloadTimeout = setTimeout(() => {
            this.downloadLogs('session_error', '嚴重');
            this.isErrorDetected = false;
        }, 500); // 極短延遲，確保在頁面重載前執行
    }

    // 實時保存日誌到localStorage
    saveLogsToStorage() {
        try {
            const data = {
                logs: this.logs,
                recentErrors: this.recentErrors,
                timestamp: Date.now()
            };
            localStorage.setItem('auto_error_logger_persistent', JSON.stringify(data));
        } catch (error) {
            console.error('實時保存日誌失敗:', error);
        }
    }

    // 排程自動下載
    scheduleAutoDownload() {
        if (this.downloadTimeout) {
            clearTimeout(this.downloadTimeout);
        }
        
        const errorCount = this.recentErrors.length;
        const severity = this.getErrorSeverity();
        
        console.log(`🚨 偵測到${severity}錯誤！(近期錯誤數: ${errorCount}) 將在 ${this.downloadDelay / 1000} 秒後自動下載日誌檔`);
        
        this.downloadTimeout = setTimeout(() => {
            // 檢查用戶設定是否停用自動下載
            const autoDownloadSetting = localStorage.getItem('auto_error_download_enabled');
            const shouldAutoDownload = autoDownloadSetting !== 'false';
            
            if (shouldAutoDownload) {
                this.downloadLogs('auto', severity);
            } else {
                console.log('🔒 自動下載已停用，跳過日誌下載');
            }
            this.isErrorDetected = false; // 重置錯誤狀態
        }, this.downloadDelay);
    }

    // 判斷錯誤嚴重程度
    getErrorSeverity() {
        const recentErrorCount = this.recentErrors.length;
        const lastError = this.recentErrors[this.recentErrors.length - 1];
        
        if (recentErrorCount >= 3) {
            return '嚴重';
        } else if (lastError && this.isSevereError(lastError.message)) {
            return '重要';
        } else {
            return '一般';
        }
    }

    // 獲取格式化時間戳
    getFormattedTimestamp() {
        const now = new Date();
        // 轉換到台北時區
        const taipeiTime = new Date(
            now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
        );

        const year = taipeiTime.getFullYear();
        const month = String(taipeiTime.getMonth() + 1).padStart(2, '0');
        const day = String(taipeiTime.getDate()).padStart(2, '0');
        const hour = String(taipeiTime.getHours()).padStart(2, '0');
        const minute = String(taipeiTime.getMinutes()).padStart(2, '0');
        const second = String(taipeiTime.getSeconds()).padStart(2, '0');
        const ms = String(taipeiTime.getMilliseconds()).padStart(3, '0');

        return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
    }

    // 生成日誌檔內容
    generateLogContent(severity = '一般') {
        const errorStats = this.getErrorStatistics();
        
        const header = [
            '='.repeat(80),
            'Spotify Lyrics Player - 自動錯誤日誌',
            '='.repeat(80),
            `生成時間: ${this.getFormattedTimestamp()}`,
            `錯誤嚴重程度: ${severity}`,
            `瀏覽器: ${navigator.userAgent}`,
            `網址: ${window.location.href}`,
            `總日誌條數: ${this.logs.length}`,
            `近期錯誤數: ${this.recentErrors.length}`,
            '='.repeat(80),
            '錯誤統計分析:',
            `• LOG 日誌: ${errorStats.LOG || 0} 條`,
            `• ERROR 錯誤: ${errorStats.ERROR || 0} 條`,
            `• WARN 警告: ${errorStats.WARN || 0} 條`,
            `• INFO 信息: ${errorStats.INFO || 0} 條`,
            '='.repeat(80),
            ''
        ].join('\n');

        const logContent = this.logs.map(log => {
            return [
                `[${log.timestamp}] [${log.level}] ${log.message}`,
                ''
            ].join('\n');
        }).join('');

        const footer = [
            '',
            '='.repeat(80),
            '日誌結束',
            '='.repeat(80)
        ].join('\n');

        return header + logContent + footer;
    }

    // 獲取錯誤統計
    getErrorStatistics() {
        const stats = {};
        this.logs.forEach(log => {
            stats[log.level] = (stats[log.level] || 0) + 1;
        });
        return stats;
    }

    // 下載日誌檔
    downloadLogs(trigger = 'manual', severity = '一般') {
        try {
            const content = this.generateLogContent(severity);
            const timestamp = this.getFormattedTimestamp().replace(/[:\s]/g, '_').replace(/\./g, '-');
            const severityPrefix = severity === '一般' ? '' : `_${severity}`;
            const filename = `spotify_lyrics_error_log_${timestamp}${severityPrefix}_${trigger}.txt`;
            
            const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            URL.revokeObjectURL(url);
            
            console.log(`📥 日誌檔已下載: ${filename} (觸發方式: ${trigger}, 嚴重程度: ${severity})`);
            
            // 顯示下載通知
            this.showDownloadNotification(filename, severity);
            
        } catch (error) {
            this.originalConsole.error('下載日誌檔失敗:', error);
        }
    }

    // 顯示下載通知
    showDownloadNotification(filename, severity = '一般') {
        // 選擇合適的圖標和顏色
        const severityConfig = {
            '嚴重': { icon: '🚨', color: '#e53e3e', bgColor: '#fed7d7' },
            '重要': { icon: '⚠️', color: '#d69e2e', bgColor: '#faf089' },
            '一般': { icon: '📥', color: '#38a169', bgColor: '#c6f6d5' }
        };
        
        const config = severityConfig[severity] || severityConfig['一般'];
        
        // 創建通知元素
        const notification = document.createElement('div');
        notification.className = 'error-log-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">${config.icon}</div>
                <div class="notification-text">
                    <div class="notification-title">錯誤日誌已下載 (${severity})</div>
                    <div class="notification-filename">${filename}</div>
                    <div class="notification-stats">近期錯誤: ${this.recentErrors.length} 個</div>
                </div>
                <button class="notification-close">×</button>
            </div>
        `;
        
        // 添加樣式（根據嚴重程度）
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${config.bgColor};
            color: ${config.color};
            border: 2px solid ${config.color};
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            max-width: 350px;
            animation: slideIn 0.3s ease-out;
        `;
        
        // 添加樣式到頁面
        if (!document.getElementById('error-log-notification-styles')) {
            const style = document.createElement('style');
            style.id = 'error-log-notification-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .notification-content {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                }
                .notification-icon {
                    font-size: 20px;
                    flex-shrink: 0;
                }
                .notification-text {
                    flex: 1;
                }
                .notification-title {
                    font-weight: 600;
                    margin-bottom: 4px;
                }
                .notification-filename {
                    font-size: 12px;
                    opacity: 0.8;
                    word-break: break-all;
                    margin-bottom: 4px;
                }
                .notification-stats {
                    font-size: 11px;
                    opacity: 0.7;
                    font-weight: 500;
                }
                .notification-close {
                    background: none;
                    border: none;
                    color: inherit;
                    opacity: 0.7;
                    cursor: pointer;
                    font-size: 18px;
                    line-height: 1;
                    padding: 0;
                    flex-shrink: 0;
                    font-weight: bold;
                }
                .notification-close:hover {
                    opacity: 1;
                }
            `;
            document.head.appendChild(style);
        }
        
        // 添加關閉事件
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        // 添加到頁面
        document.body.appendChild(notification);
        
        // 5秒後自動關閉
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    // 添加手動下載按鈕
    addDownloadButton() {
        // 等待頁面載入完成
        const addButton = () => {
            // 檢查是否已經有按鈕
            if (document.getElementById('manual-log-download-btn')) {
                return;
            }
            
            const button = document.createElement('button');
            button.id = 'manual-log-download-btn';
            button.innerHTML = '📥 下載日誌';
            button.title = '手動下載日誌檔';
            
            button.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: #1db954;
                color: white;
                border: none;
                border-radius: 50px;
                padding: 12px 20px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                z-index: 9999;
                box-shadow: 0 2px 10px rgba(29, 185, 84, 0.3);
                transition: all 0.2s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            `;
            
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'translateY(-2px)';
                button.style.boxShadow = '0 4px 15px rgba(29, 185, 84, 0.4)';
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'translateY(0)';
                button.style.boxShadow = '0 2px 10px rgba(29, 185, 84, 0.3)';
            });
            
            button.addEventListener('click', () => {
                this.downloadLogs('manual');
            });
            
            // 添加切換自動下載的按鈕
            const toggleButton = document.createElement('button');
            toggleButton.id = 'toggle-auto-download-btn';
            const autoDownloadSetting = localStorage.getItem('auto_error_download_enabled');
            const isAutoEnabled = autoDownloadSetting !== 'false';
            toggleButton.innerHTML = isAutoEnabled ? '🔒 停用自動下載' : '🔓 啟用自動下載';
            toggleButton.title = '切換自動下載日誌設定';
            toggleButton.style.cssText = `
                position: fixed;
                bottom: 80px;
                right: 20px;
                z-index: 9999;
                padding: 12px 20px;
                background: ${isAutoEnabled ? 
                    'linear-gradient(135deg, #ff6b35, #f7931e)' : 
                    'linear-gradient(135deg, #1db954, #1ed760)'};
                color: white;
                border: none;
                border-radius: 25px;
                font-weight: 600;
                font-size: 14px;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(29, 185, 84, 0.3);
                transition: all 0.3s ease;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            `;
            
            toggleButton.addEventListener('click', () => {
                const currentSetting = localStorage.getItem('auto_error_download_enabled');
                const newSetting = currentSetting === 'false' ? 'true' : 'false';
                localStorage.setItem('auto_error_download_enabled', newSetting);
                
                const isEnabled = newSetting === 'true';
                toggleButton.innerHTML = isEnabled ? '🔒 停用自動下載' : '🔓 啟用自動下載';
                toggleButton.style.background = isEnabled ? 
                    'linear-gradient(135deg, #ff6b35, #f7931e)' : 
                    'linear-gradient(135deg, #1db954, #1ed760)';
                    
                console.log(`🔄 自動下載已${isEnabled ? '啟用' : '停用'}`);
            });
            
            document.body.appendChild(button);
            document.body.appendChild(toggleButton);
        };
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addButton);
        } else {
            addButton();
        }
    }

    // 清除日誌
    clearLogs() {
        this.logs = [];
        console.log('🧹 日誌已清除');
    }

    // 獲取日誌統計
    getLogStats() {
        const stats = {
            total: this.logs.length,
            byLevel: {}
        };
        
        this.logs.forEach(log => {
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
        });
        
        return stats;
    }

    // 銷毀日誌系統
    destroy() {
        // 恢復原始 console 方法
        Object.keys(this.originalConsole).forEach(method => {
            console[method] = this.originalConsole[method];
        });
        
        // 清除定時器
        if (this.downloadTimeout) {
            clearTimeout(this.downloadTimeout);
        }
        
        if (this.sessionCheckInterval) {
            clearInterval(this.sessionCheckInterval);
        }
        
        // 移除按鈕
        const button = document.getElementById('manual-log-download-btn');
        if (button) {
            button.remove();
        }
        
        // 清理持久化數據
        localStorage.removeItem('auto_error_logger_persistent');
        localStorage.removeItem('auto_error_logger_has_errors');
        
        console.log('🔍 自動錯誤日誌系統已停用');
    }
}

// 全域變數，供外部控制
window.autoErrorLogger = null;

// 自動初始化
document.addEventListener('DOMContentLoaded', () => {
    window.autoErrorLogger = new AutoErrorLogger();
    
    // 暴露控制方法到全域
    window.downloadLogs = () => window.autoErrorLogger.downloadLogs('manual');
    window.clearLogs = () => window.autoErrorLogger.clearLogs();
    window.getLogStats = () => window.autoErrorLogger.getLogStats();
});

// 如果頁面已經載入完成，立即初始化
if (document.readyState !== 'loading') {
    window.autoErrorLogger = new AutoErrorLogger();
    window.downloadLogs = () => window.autoErrorLogger.downloadLogs('manual');
    window.clearLogs = () => window.autoErrorLogger.clearLogs();
    window.getLogStats = () => window.autoErrorLogger.getLogStats();
}