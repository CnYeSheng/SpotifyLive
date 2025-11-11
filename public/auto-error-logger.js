/**
 * 自動錯誤日誌系統
 * 當偵測到 console.log 中有錯誤訊息時，自動下載包含所有訊息的日誌檔
 */

class AutoErrorLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000; // 最多保存1000條日誌
        this.errorKeywords = ['錯誤', '失敗', '異常', 'error', 'fail', 'exception', 'timeout', '❌', '⚠️'];
        this.isErrorDetected = false;
        this.downloadDelay = 2000; // 錯誤偵測後2秒自動下載
        this.downloadTimeout = null;
        
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
        this.interceptConsoleMethods();
        this.setupErrorDetection();
        this.addDownloadButton();
        console.log('🔍 自動錯誤日誌系統已啟動');
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
        
        // 檢查是否包含錯誤關鍵字
        this.checkForErrors(message);
    }

    // 檢查錯誤關鍵字
    checkForErrors(message) {
        const messageStr = message.toLowerCase();
        const hasError = this.errorKeywords.some(keyword => 
            messageStr.includes(keyword.toLowerCase())
        );
        
        if (hasError && !this.isErrorDetected) {
            this.isErrorDetected = true;
            this.scheduleAutoDownload();
        }
    }

    // 排程自動下載
    scheduleAutoDownload() {
        if (this.downloadTimeout) {
            clearTimeout(this.downloadTimeout);
        }
        
        console.log(`🚨 偵測到錯誤！將在 ${this.downloadDelay / 1000} 秒後自動下載日誌檔`);
        
        this.downloadTimeout = setTimeout(() => {
            this.downloadLogs('auto');
            this.isErrorDetected = false; // 重置錯誤狀態
        }, this.downloadDelay);
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
    generateLogContent() {
        const header = [
            '='.repeat(80),
            'Spotify Lyrics Player - 自動錯誤日誌',
            '='.repeat(80),
            `生成時間: ${this.getFormattedTimestamp()}`,
            `瀏覽器: ${navigator.userAgent}`,
            `網址: ${window.location.href}`,
            `總日誌條數: ${this.logs.length}`,
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

    // 下載日誌檔
    downloadLogs(trigger = 'manual') {
        try {
            const content = this.generateLogContent();
            const timestamp = this.getFormattedTimestamp().replace(/[:\s]/g, '_').replace(/\./g, '-');
            const filename = `spotify_lyrics_error_log_${timestamp}_${trigger}.txt`;
            
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
            
            console.log(`📥 日誌檔已下載: ${filename} (觸發方式: ${trigger})`);
            
            // 顯示下載通知
            this.showDownloadNotification(filename);
            
        } catch (error) {
            this.originalConsole.error('下載日誌檔失敗:', error);
        }
    }

    // 顯示下載通知
    showDownloadNotification(filename) {
        // 創建通知元素
        const notification = document.createElement('div');
        notification.className = 'error-log-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">📥</div>
                <div class="notification-text">
                    <div class="notification-title">日誌檔已下載</div>
                    <div class="notification-filename">${filename}</div>
                </div>
                <button class="notification-close">×</button>
            </div>
        `;
        
        // 添加樣式
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #2d3748;
            color: #fff;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            max-width: 300px;
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
                    color: #a0aec0;
                    word-break: break-all;
                }
                .notification-close {
                    background: none;
                    border: none;
                    color: #a0aec0;
                    cursor: pointer;
                    font-size: 20px;
                    line-height: 1;
                    padding: 0;
                    flex-shrink: 0;
                }
                .notification-close:hover {
                    color: #fff;
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
            
            document.body.appendChild(button);
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
        
        // 移除按鈕
        const button = document.getElementById('manual-log-download-btn');
        if (button) {
            button.remove();
        }
        
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