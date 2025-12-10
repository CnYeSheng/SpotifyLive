// 增強的 Session 過期自動登入管理系統
// Enhanced Session Expiry Auto-Login Management System

class EnhancedSessionManager {
    constructor(player) {
        this.player = player;
        this.sessionExpiryCheckInterval = null;
        this.sessionValidationInterval = null;
        this.autoLoginRetryCount = 0;
        this.maxAutoLoginRetries = 3;
        this.isSessionExpired = false;
        this.lastSuccessfulRequest = Date.now();
        this.sessionExpiryWarningShown = false;
        
        // Session 過期檢測相關設定
        this.sessionCheckIntervalMs = 2 * 60 * 1000; // 每2分鐘檢查一次
        this.sessionExpiryThresholdMs = 5 * 60 * 1000; // 5分鐘內過期視為即將過期
        this.autoLoginDelayMs = 3000; // 自動登入延遲 3 秒
        
        // 過期偵測方法
        this.expiredDetectionMethods = {
            api401Errors: true,        // API 401 錯誤
            consecutiveFailures: true, // 連續失敗
            timeBasedExpiry: true,     // 時間基礎過期
            heartbeatFailure: true     // 心跳檢測失敗
        };
        
        // 自動登入觸發條件
        this.autoLoginTriggers = {
            onSessionExpiry: true,     // Session 過期時
            onAPIFailure: true,        // API 失敗時
            onHeartbeatFail: true,     // 心跳失敗時
            onUserInteraction: true    // 用戶交互時
        };
        
        this.log = (message, type = 'info') => {
            const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            console.log(`[${now}] [SessionManager] ${message}`);
        };
        
        this.init();
    }
    
    init() {
        this.log('🚀 初始化增強 Session 管理器');
        this.startSessionMonitoring();
        this.setupVisibilityHandling();
        this.setupUserInteractionDetection();
        this.restoreSessionState();
    }
    
    // 開始 Session 監控
    startSessionMonitoring() {
        // 定期檢查 session 狀態
        if (this.sessionExpiryCheckInterval) {
            clearInterval(this.sessionExpiryCheckInterval);
        }
        
        this.sessionExpiryCheckInterval = setInterval(() => {
            this.performSessionValidation();
        }, this.sessionCheckIntervalMs);
        
        // 立即執行一次檢查
        setTimeout(() => this.performSessionValidation(), 1000);
        
        this.log(`✅ Session 監控已啟動 - 間隔: ${this.sessionCheckIntervalMs/1000}秒`);
    }
    
    // 執行 Session 驗證
    async performSessionValidation() {
        if (!this.player.sessionId) {
            this.log('⏭️ 跳過 Session 驗證 - 沒有 sessionId');
            return;
        }
        
        try {
            this.log('🔍 執行 Session 驗證...');
            
            const response = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.player.sessionId },
                timeout: 8000
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    this.onSessionValid();
                } else {
                    this.onSessionExpired('auth-status-invalid');
                }
            } else if (response.status === 401) {
                this.onSessionExpired('auth-status-401');
            } else {
                this.log(`⚠️ Session 驗證異常: ${response.status}`);
            }
        } catch (error) {
            this.log(`❌ Session 驗證失敗: ${error.message}`);
            this.onSessionValidationError(error);
        }
    }
    
    // Session 有效時的處理
    onSessionValid() {
        this.lastSuccessfulRequest = Date.now();
        this.autoLoginRetryCount = 0;
        this.isSessionExpired = false;
        this.sessionExpiryWarningShown = false;
        this.log('✅ Session 驗證成功');
    }
    
    // Session 過期時的處理
    onSessionExpired(reason) {
        this.log(`🔑 Session 已過期 - 原因: ${reason}`);
        this.isSessionExpired = true;
        
        // 觸發自動登入
        if (this.autoLoginTriggers.onSessionExpiry) {
            this.triggerAutoLogin(reason);
        }
    }
    
    // Session 驗證錯誤時的處理
    onSessionValidationError(error) {
        // 網路錯誤不立即觸發登入，但記錄
        this.log(`⚠️ Session 驗證錯誤，但不觸發登入: ${error.message}`);
    }
    
    // 觸發自動登入
    async triggerAutoLogin(reason = 'unknown') {
        if (this.autoLoginRetryCount >= this.maxAutoLoginRetries) {
            this.log(`❌ 自動登入已達最大重試次數 (${this.maxAutoLoginRetries})`);
            this.showAutoLoginFailedMessage();
            return;
        }
        
        this.autoLoginRetryCount++;
        this.log(`🔄 觸發自動登入 (${this.autoLoginRetryCount}/${this.maxAutoLoginRetries}) - 原因: ${reason}`);
        
        // 顯示自動登入通知
        this.showAutoLoginNotification(reason);
        
        // 延遲後執行自動登入
        setTimeout(() => {
            this.executeAutoLogin();
        }, this.autoLoginDelayMs);
    }
    
    // 執行自動登入
    executeAutoLogin() {
        try {
            this.log('🚀 執行自動登入重定向...');
            
            // 清除當前 session
            this.clearCurrentSession();
            
            // 重定向到登入頁面
            window.location.href = '/api/auth';
        } catch (error) {
            this.log(`❌ 自動登入執行失敗: ${error.message}`);
        }
    }
    
    // 清除當前 session
    clearCurrentSession() {
        try {
            localStorage.removeItem('spotify_session_id');
            localStorage.removeItem('spotify_session_data');
            this.player.sessionId = null;
            this.log('🗑️ 已清除當前 session');
        } catch (error) {
            this.log(`❌ 清除 session 失敗: ${error.message}`);
        }
    }
    
    // 設置頁面可見性處理
    setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.log('👁️ 頁面重新可見，檢查 session 狀態');
                // 頁面重新可見時立即檢查 session
                setTimeout(() => this.performSessionValidation(), 500);
            }
        });
    }
    
    // 設置用戶交互偵測
    setupUserInteractionDetection() {
        const interactionEvents = ['click', 'keydown', 'scroll', 'mousemove'];
        
        let lastInteractionCheck = 0;
        const checkInterval = 30000; // 30秒檢查一次
        
        const handleInteraction = () => {
            const now = Date.now();
            if (now - lastInteractionCheck > checkInterval) {
                lastInteractionCheck = now;
                
                // 如果 session 已過期且用戶正在交互，觸發自動登入
                if (this.isSessionExpired && this.autoLoginTriggers.onUserInteraction) {
                    this.log('👆 檢測到用戶交互且 session 已過期，觸發自動登入');
                    this.triggerAutoLogin('user-interaction');
                }
            }
        };
        
        interactionEvents.forEach(eventName => {
            document.addEventListener(eventName, handleInteraction, { passive: true });
        });
    }
    
    // API 請求錯誤處理 (供外部調用)
    handleAPIError(error, requestUrl) {
        if (error.status === 401 || error.message.includes('401')) {
            this.log(`🚫 檢測到 401 錯誤 - URL: ${requestUrl}`);
            
            if (this.autoLoginTriggers.onAPIFailure) {
                this.onSessionExpired('api-401-error');
            }
        } else if (error.status === 403) {
            this.log(`🚫 檢測到 403 錯誤，可能是權限問題 - URL: ${requestUrl}`);
        }
    }
    
    // 顯示自動登入通知
    showAutoLoginNotification(reason) {
        const notification = document.createElement('div');
        notification.className = 'auto-login-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #ff6b6b, #ee5a52);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(255, 107, 107, 0.4);
            z-index: 10000;
            font-weight: 600;
            text-align: center;
            animation: slideInTop 0.3s ease;
            max-width: 400px;
        `;
        
        notification.innerHTML = `
            <div style="font-size: 18px; margin-bottom: 8px;">🔑 Session 已過期</div>
            <div style="font-size: 14px; opacity: 0.9;">正在自動重新登入 Spotify...</div>
            <div style="font-size: 12px; margin-top: 8px; opacity: 0.7;">原因: ${this.getReasonText(reason)}</div>
        `;
        
        // 添加樣式
        if (!document.getElementById('auto-login-styles')) {
            const style = document.createElement('style');
            style.id = 'auto-login-styles';
            style.textContent = `
                @keyframes slideInTop {
                    from { transform: translate(-50%, -100%); opacity: 0; }
                    to { transform: translate(-50%, 0); opacity: 1; }
                }
                @keyframes slideOutTop {
                    from { transform: translate(-50%, 0); opacity: 1; }
                    to { transform: translate(-50%, -100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        // 3秒後移除通知
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOutTop 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 3000);
    }
    
    // 顯示自動登入失敗消息
    showAutoLoginFailedMessage() {
        const notification = document.createElement('div');
        notification.className = 'auto-login-failed-notification';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #e74c3c, #c0392b);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(231, 76, 60, 0.4);
            z-index: 10000;
            font-weight: 600;
            text-align: center;
            max-width: 400px;
        `;
        
        notification.innerHTML = `
            <div style="font-size: 18px; margin-bottom: 8px;">❌ 自動登入失敗</div>
            <div style="font-size: 14px; margin-bottom: 12px;">請手動點擊登入按鈕重新連接 Spotify</div>
            <button onclick="window.location.href='/api/auth'" style="
                background: rgba(255,255,255,0.2);
                border: 1px solid rgba(255,255,255,0.3);
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
            ">立即登入</button>
        `;
        
        document.body.appendChild(notification);
        
        // 10秒後自動移除
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 10000);
    }
    
    // 獲取原因文字描述
    getReasonText(reason) {
        const reasonTexts = {
            'auth-status-invalid': 'Session 驗證失效',
            'auth-status-401': 'Session 認證失敗',
            'api-401-error': 'API 認證錯誤',
            'user-interaction': '用戶操作觸發',
            'heartbeat-failure': '心跳檢測失敗',
            'time-based-expiry': '時間到期',
            'unknown': '未知原因'
        };
        
        return reasonTexts[reason] || reason;
    }
    
    // 恢復 Session 狀態
    restoreSessionState() {
        try {
            const savedState = localStorage.getItem('session_manager_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                this.autoLoginRetryCount = state.retryCount || 0;
                this.lastSuccessfulRequest = state.lastSuccess || Date.now();
            }
        } catch (error) {
            this.log(`⚠️ 恢復 Session 狀態失敗: ${error.message}`);
        }
    }
    
    // 保存 Session 狀態
    saveSessionState() {
        try {
            const state = {
                retryCount: this.autoLoginRetryCount,
                lastSuccess: this.lastSuccessfulRequest,
                timestamp: Date.now()
            };
            localStorage.setItem('session_manager_state', JSON.stringify(state));
        } catch (error) {
            this.log(`⚠️ 保存 Session 狀態失敗: ${error.message}`);
        }
    }
    
    // 重置重試計數器 (成功登入後調用)
    resetRetryCount() {
        this.autoLoginRetryCount = 0;
        this.isSessionExpired = false;
        this.saveSessionState();
        this.log('🔄 已重置自動登入重試計數器');
    }
    
    // 停止 Session 監控
    stopSessionMonitoring() {
        if (this.sessionExpiryCheckInterval) {
            clearInterval(this.sessionExpiryCheckInterval);
            this.sessionExpiryCheckInterval = null;
        }
        this.log('⏹️ Session 監控已停止');
    }
    
    // 手動觸發 Session 檢查 (供外部調用)
    async checkSessionNow() {
        this.log('🔍 手動觸發 Session 檢查...');
        await this.performSessionValidation();
    }
    
    // 銷毀管理器
    destroy() {
        this.stopSessionMonitoring();
        this.saveSessionState();
        this.log('🗑️ Session 管理器已銷毀');
    }
    
    // 獲取狀態信息
    getStatus() {
        return {
            isExpired: this.isSessionExpired,
            retryCount: this.autoLoginRetryCount,
            maxRetries: this.maxAutoLoginRetries,
            lastSuccessfulRequest: new Date(this.lastSuccessfulRequest).toLocaleString('zh-TW'),
            monitoringActive: !!this.sessionExpiryCheckInterval
        };
    }
}

// 導出供其他模塊使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedSessionManager;
} else if (typeof window !== 'undefined') {
    window.EnhancedSessionManager = EnhancedSessionManager;
}