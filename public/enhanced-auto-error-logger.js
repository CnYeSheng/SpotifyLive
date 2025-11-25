/**
 * 增強版自動錯誤日誌系統
 * 新增功能：
 * 1. 可選擇是否自動下載日誌
 * 2. 改善用戶介面
 * 3. 更好的錯誤處理
 */

class EnhancedAutoErrorLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.errorKeywords = [
            '連線錯誤', '請求失敗', '載入失敗', '初始化失敗', '認證失敗', 
            'connection error', 'request failed', 'load failed', 'init failed', 'auth failed',
            'network error', 'api error', 'server error', 'timeout error',
            'session.*失效', 'session.*過期', 'session.*invalid', 'token.*過期', 'token.*expired',
            '401', '403', 'unauthorized', 'forbidden', '認證過期', '登入失效',
            'exception', 'crash', 'fatal', '嚴重錯誤', '致命錯誤',
            '500 ', '502 ', '503 ', '504 ', 'internal server error'
        ];
        
        this.warningKeywords = [
            '無下一首數據', '獲取失敗', '隊列為空', '沒有找到', '跳過',
            'no data', 'not found', 'skip', 'empty queue', 'no session',
            '⚠️', '❌ 沒有找到', '❌ checkAuthStatus'
        ];
        
        // 新增：用戶可控制的自動下載設定
        this.autoDownloadEnabled = localStorage.getItem('auto_error_download_enabled') !== 'false';
        
        this.isErrorDetected = false;
        this.downloadDelay = 1500;
        this.downloadTimeout = null;
        this.recentErrors = [];
        this.isActive = true;
        
        this.originalConsole = {
            log: console.log.bind(console),
            error: console.error.bind(console),
            warn: console.warn.bind(console),
            info: console.info.bind(console)
        };
        
        this.init();
        this.setupConsoleInterception();
        this.setupSessionMonitoring();
        this.addControlPanel();
        
        console.log('🔍 增強版自動錯誤日誌系統已啟動');
    }

    init() {
        // 恢復歷史日誌
        try {
            const stored = localStorage.getItem('auto_error_logger_persistent');
            if (stored) {
                const data = JSON.parse(stored);
                this.logs = data.logs || [];
                
                // 清理超過10分鐘的舊日誌
                const now = Date.now();
                this.logs = this.logs.filter(log => now - log.timestamp < 600000);
                
                if (this.logs.length > 0) {
                    console.log(`🔄 恢復 ${this.logs.length} 條歷史日誌`);
                }
            }
            
            localStorage.removeItem('auto_error_logger_persistent');
            
        } catch (error) {
            console.log('❌ 恢復歷史日誌失敗:', error.message);
        }
        
        // 檢查頁面重載前是否有錯誤
        const errorFlag = localStorage.getItem('auto_error_logger_has_errors');
        if (errorFlag === 'true') {
            console.log('🚨 檢測到頁面重載前有錯誤，立即觸發下載');
            if (this.autoDownloadEnabled) {
                this.downloadLogs('reload_recovery', '重要');
            } else {
                this.showDownloadPrompt('重要');
            }
            localStorage.removeItem('auto_error_logger_has_errors');
        }
    }

    setupConsoleInterception() {
        ['log', 'error', 'warn', 'info'].forEach(method => {
            console[method] = (...args) => {
                this.originalConsole[method](...args);
                
                if (!this.isActive) return;
                
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');
                
                const level = method.toUpperCase();
                this.logMessage(message, level);
            };
        });
    }

    logMessage(message, level) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
            id: Date.now() + Math.random()
        };
        
        this.logs.push(logEntry);
        
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
        
        // 檢查是否需要觸發下載
        if (this.shouldTriggerDownload(message, level)) {
            this.recordError(message);
            this.scheduleAutoDownload();
        }
    }

    shouldTriggerDownload(message, level) {
        // 檢查是否為警告級別（不觸發下載）
        if (this.warningKeywords.some(keyword => 
            new RegExp(keyword, 'i').test(message))) {
            return false;
        }
        
        // 檢查是否包含錯誤關鍵字
        return this.errorKeywords.some(keyword => 
            new RegExp(keyword, 'i').test(message)
        ) || level === 'ERROR';
    }

    recordError(message) {
        const now = Date.now();
        this.recentErrors.push(now);
        
        // 保留最近30秒的錯誤記錄
        this.recentErrors = this.recentErrors.filter(time => now - time < 30000);
    }

    scheduleAutoDownload() {
        if (this.isErrorDetected) {
            return;
        }
        
        this.isErrorDetected = true;
        const errorCount = this.recentErrors.length;
        const severity = this.determineSeverity(errorCount);
        
        // 保存錯誤狀態
        const data = {
            timestamp: Date.now(),
            logs: this.logs,
            hasErrors: true
        };
        localStorage.setItem('auto_error_logger_persistent', JSON.stringify(data));
        
        if (this.recentErrors.length >= 3) {
            localStorage.setItem('auto_error_logger_has_errors', 'true');
        }
        
        console.log(`🚨 偵測到${severity}錯誤！(近期錯誤數: ${errorCount}) 將在 ${this.downloadDelay / 1000} 秒後處理`);
        
        this.downloadTimeout = setTimeout(() => {
            if (this.autoDownloadEnabled) {
                this.downloadLogs('auto', severity);
            } else {
                console.log('🔒 自動下載已停用，顯示下載提示');
                this.showDownloadPrompt(severity);
            }
            this.isErrorDetected = false;
        }, this.downloadDelay);
    }

    determineSeverity(errorCount) {
        if (errorCount >= 5) return '嚴重';
        if (errorCount >= 3) return '重要';
        return '一般';
    }

    showDownloadPrompt(severity = '一般') {
        const notification = document.createElement('div');
        notification.className = 'download-prompt-notification';
        notification.innerHTML = `
            <div class="prompt-content">
                <div class="prompt-header">
                    <span class="prompt-icon">⚠️</span>
                    <span class="prompt-title">檢測到${severity}錯誤</span>
                </div>
                <div class="prompt-message">自動下載已停用，是否手動下載日誌？</div>
                <div class="prompt-actions">
                    <button class="prompt-btn download-btn" data-action="download" data-severity="${severity}">
                        📥 下載日誌
                    </button>
                    <button class="prompt-btn dismiss-btn" data-action="dismiss">
                        ❌ 忽略
                    </button>
                </div>
            </div>
        `;
        
        // 添加事件監聽器
        notification.querySelector('.download-btn').addEventListener('click', () => {
            this.downloadLogs('prompt', severity);
            notification.remove();
        });
        
        notification.querySelector('.dismiss-btn').addEventListener('click', () => {
            notification.remove();
        });
        
        // 添加樣式
        this.addPromptStyles();
        
        document.body.appendChild(notification);
        
        // 10秒後自動移除
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 10000);
    }

    addPromptStyles() {
        if (document.getElementById('download-prompt-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'download-prompt-styles';
        style.textContent = `
            .download-prompt-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #ff6b35, #f7931e);
                color: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(255, 107, 53, 0.3);
                z-index: 10000;
                animation: slideInFromRight 0.3s ease;
                max-width: 350px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .prompt-content {
                padding: 16px;
            }
            .prompt-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }
            .prompt-icon {
                font-size: 20px;
            }
            .prompt-title {
                font-weight: 600;
                font-size: 16px;
            }
            .prompt-message {
                margin-bottom: 12px;
                font-size: 14px;
                line-height: 1.4;
            }
            .prompt-actions {
                display: flex;
                gap: 8px;
            }
            .prompt-btn {
                flex: 1;
                padding: 8px 12px;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .download-btn {
                background: rgba(255, 255, 255, 0.2);
                color: white;
            }
            .download-btn:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            .dismiss-btn {
                background: rgba(0, 0, 0, 0.2);
                color: white;
            }
            .dismiss-btn:hover {
                background: rgba(0, 0, 0, 0.3);
            }
            @keyframes slideInFromRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    downloadLogs(trigger = 'manual', severity = '一般') {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const severityPrefix = severity === '嚴重' ? '_CRITICAL' : severity === '重要' ? '_IMPORTANT' : '';
        const filename = `spotify_lyrics_error_log_${timestamp}${severityPrefix}_${trigger}.txt`;
        
        const content = this.generateLogContent();
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`📥 日誌檔已下載: ${filename} (觸發方式: ${trigger}, 嚴重程度: ${severity})`);
        
        this.showDownloadNotification(filename, trigger);
    }

    generateLogContent() {
        const header = [
            '='.repeat(80),
            'Spotify 歌詞播放器 - 錯誤日誌報告',
            '='.repeat(80),
            `生成時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
            `瀏覽器: ${navigator.userAgent}`,
            `當前網址: ${window.location.href}`,
            `總日誌條數: ${this.logs.length}`,
            '='.repeat(80),
            ''
        ].join('\n');
        
        const logContent = this.logs.map(log => {
            return [
                `[${log.timestamp}] [${log.level}] ${log.message}`,
                ''
            ].join('\n');
        }).join('\n');
        
        const footer = [
            '',
            '='.repeat(80),
            '日誌報告結束',
            '='.repeat(80)
        ].join('\n');
        
        return header + logContent + footer;
    }

    showDownloadNotification(filename, trigger) {
        const notification = document.createElement('div');
        notification.className = 'download-notification';
        notification.innerHTML = `
            <div class="download-content">
                <span class="download-icon">📥</span>
                <div class="download-text">
                    <div class="download-title">日誌已下載</div>
                    <div class="download-filename">${filename}</div>
                </div>
            </div>
        `;
        
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #1db954, #1ed760);
            color: white;
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(29, 185, 84, 0.3);
            z-index: 10000;
            animation: slideInFromBottom 0.3s ease;
            max-width: 350px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            .download-content {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .download-icon {
                font-size: 24px;
            }
            .download-title {
                font-weight: 600;
                font-size: 14px;
            }
            .download-filename {
                font-size: 12px;
                opacity: 0.9;
                word-break: break-all;
            }
            @keyframes slideInFromBottom {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideInFromBottom 0.3s ease reverse';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 3000);
    }

    addControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'error-logger-control-panel';
        panel.innerHTML = `
            <div class="control-panel-content">
                <div class="panel-header">
                    <span class="panel-icon">🔧</span>
                    <span class="panel-title">日誌控制</span>
                    <button class="panel-toggle" id="panel-toggle">▼</button>
                </div>
                <div class="panel-body" id="panel-body">
                    <button class="control-btn download-btn" id="manual-download-btn">
                        📥 手動下載
                    </button>
                    <button class="control-btn toggle-btn" id="toggle-auto-download-btn">
                        ${this.autoDownloadEnabled ? '🔒 停用自動下載' : '🔓 啟用自動下載'}
                    </button>
                    <button class="control-btn clear-btn" id="clear-logs-btn">
                        🗑️ 清除日誌
                    </button>
                    <div class="status-info" id="status-info">
                        日誌數量: <span id="log-count">${this.logs.length}</span>
                    </div>
                </div>
            </div>
        `;
        
        this.addControlPanelStyles();
        document.body.appendChild(panel);
        
        this.bindControlPanelEvents();
    }

    addControlPanelStyles() {
        const style = document.createElement('style');
        style.id = 'control-panel-styles';
        style.textContent = `
            #error-logger-control-panel {
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.9);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                z-index: 9999;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 300px;
                transition: all 0.3s ease;
            }
            .control-panel-content {
                padding: 16px;
            }
            .panel-header {
                display: flex;
                align-items: center;
                gap: 8px;
                color: white;
                margin-bottom: 12px;
                cursor: pointer;
            }
            .panel-icon {
                font-size: 18px;
            }
            .panel-title {
                flex: 1;
                font-weight: 600;
                font-size: 14px;
            }
            .panel-toggle {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 12px;
                transition: transform 0.3s ease;
            }
            .panel-body {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 200px;
                overflow: hidden;
                transition: max-height 0.3s ease;
            }
            .panel-body.collapsed {
                max-height: 0;
            }
            .control-btn {
                padding: 8px 12px;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                color: white;
            }
            .download-btn {
                background: linear-gradient(135deg, #1db954, #1ed760);
            }
            .download-btn:hover {
                transform: scale(1.02);
                box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
            }
            .toggle-btn {
                background: ${this.autoDownloadEnabled ? 
                    'linear-gradient(135deg, #ff6b35, #f7931e)' : 
                    'linear-gradient(135deg, #1db954, #1ed760)'};
            }
            .toggle-btn:hover {
                transform: scale(1.02);
            }
            .clear-btn {
                background: linear-gradient(135deg, #e74c3c, #c0392b);
            }
            .clear-btn:hover {
                transform: scale(1.02);
                box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
            }
            .status-info {
                color: rgba(255, 255, 255, 0.7);
                font-size: 11px;
                text-align: center;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
        `;
        document.head.appendChild(style);
    }

    bindControlPanelEvents() {
        // 面板摺疊/展開
        document.getElementById('panel-toggle').addEventListener('click', () => {
            const body = document.getElementById('panel-body');
            const toggle = document.getElementById('panel-toggle');
            
            body.classList.toggle('collapsed');
            toggle.style.transform = body.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
        });
        
        // 手動下載
        document.getElementById('manual-download-btn').addEventListener('click', () => {
            this.downloadLogs('manual');
        });
        
        // 切換自動下載
        document.getElementById('toggle-auto-download-btn').addEventListener('click', () => {
            this.toggleAutoDownload();
        });
        
        // 清除日誌
        document.getElementById('clear-logs-btn').addEventListener('click', () => {
            this.clearLogs();
        });
    }

    toggleAutoDownload() {
        this.autoDownloadEnabled = !this.autoDownloadEnabled;
        localStorage.setItem('auto_error_download_enabled', this.autoDownloadEnabled.toString());
        
        const toggleBtn = document.getElementById('toggle-auto-download-btn');
        if (toggleBtn) {
            toggleBtn.innerHTML = this.autoDownloadEnabled ? '🔒 停用自動下載' : '🔓 啟用自動下載';
            toggleBtn.style.background = this.autoDownloadEnabled ? 
                'linear-gradient(135deg, #ff6b35, #f7931e)' : 
                'linear-gradient(135deg, #1db954, #1ed760)';
        }
        
        console.log(`🔄 自動下載設定已${this.autoDownloadEnabled ? '開啟' : '關閉'}`);
        return this.autoDownloadEnabled;
    }

    clearLogs() {
        this.logs = [];
        const logCount = document.getElementById('log-count');
        if (logCount) {
            logCount.textContent = '0';
        }
        console.log('🧹 日誌已清除');
    }

    setupSessionMonitoring() {
        // Session 監控保持原有功能
        console.log('🔐 Session監控系統已啟動');
    }

    destroy() {
        this.isActive = false;
        
        // 恢復原始 console 方法
        Object.keys(this.originalConsole).forEach(method => {
            console[method] = this.originalConsole[method];
        });
        
        // 移除控制面板
        const panel = document.getElementById('error-logger-control-panel');
        if (panel) {
            panel.remove();
        }
        
        // 清理樣式
        const styles = ['control-panel-styles', 'download-prompt-styles'];
        styles.forEach(id => {
            const style = document.getElementById(id);
            if (style) {
                style.remove();
            }
        });
        
        console.log('🔍 增強版自動錯誤日誌系統已停用');
    }
}

// 全域控制
window.enhancedAutoErrorLogger = null;

// 自動初始化
document.addEventListener('DOMContentLoaded', () => {
    window.enhancedAutoErrorLogger = new EnhancedAutoErrorLogger();
    
    // 暴露控制方法
    window.downloadLogs = () => window.enhancedAutoErrorLogger.downloadLogs('manual');
    window.clearLogs = () => window.enhancedAutoErrorLogger.clearLogs();
    window.toggleAutoDownload = () => window.enhancedAutoErrorLogger.toggleAutoDownload();
});

// 如果頁面已載入完成，立即初始化
if (document.readyState !== 'loading') {
    window.enhancedAutoErrorLogger = new EnhancedAutoErrorLogger();
    window.downloadLogs = () => window.enhancedAutoErrorLogger.downloadLogs('manual');
    window.clearLogs = () => window.enhancedAutoErrorLogger.clearLogs();
    window.toggleAutoDownload = () => window.enhancedAutoErrorLogger.toggleAutoDownload();
}