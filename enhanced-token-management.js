// 增強的 Token/會話自動管理系統
// Enhanced Token/Session Auto-Management System

class EnhancedTokenManager {
    constructor() {
        this.sessionId = null;
        this.tokenExpiresAt = null;
        this.refreshToken = null;
        this.isRefreshing = false;
        this.refreshPromise = null;
        this.autoRefreshTimer = null;
        this.heartbeatTimer = null;
        this.retryQueue = [];
        this.maxRetries = 3;
        this.baseRetryDelay = 1000;
        
        // 事件監聽器
        this.onTokenRefreshed = null;
        this.onAuthRequired = null;
        this.onError = null;
        
        this.log = (message, type = 'info') => {
            const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            console.log(`[${timestamp}] [TokenManager] ${message}`);
        };
        
        this.init();
    }
    
    init() {
        this.loadStoredSession();
        this.setupAutoRefresh();
        this.setupHeartbeat();
        this.setupVisibilityHandling();
    }
    
    // 從 localStorage 載入已存儲的會話
    loadStoredSession() {
        try {
            const storedData = localStorage.getItem('spotify_session_data');
            if (storedData) {
                const sessionData = JSON.parse(storedData);
                this.sessionId = sessionData.sessionId;
                this.tokenExpiresAt = sessionData.expiresAt;
                this.refreshToken = sessionData.refreshToken;
                
                this.log(`✅ 從存儲載入會話: ${this.sessionId?.substring(0, 8)}...`);
                
                // 檢查 token 是否即將過期
                if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt - 5 * 60 * 1000) {
                    this.log('⚠️ Token 即將過期，準備刷新');
                    this.scheduleTokenRefresh(1000); // 1秒後刷新
                }
            }
        } catch (error) {
            this.log(`❌ 載入存儲會話失敗: ${error.message}`);
            this.clearStoredSession();
        }
    }
    
    // 保存會話到 localStorage
    saveSession(sessionId, expiresAt, refreshToken) {
        try {
            const sessionData = {
                sessionId,
                expiresAt,
                refreshToken,
                savedAt: Date.now()
            };
            
            localStorage.setItem('spotify_session_data', JSON.stringify(sessionData));
            
            this.sessionId = sessionId;
            this.tokenExpiresAt = expiresAt;
            this.refreshToken = refreshToken;
            
            this.log(`✅ 會話已保存: ${sessionId?.substring(0, 8)}...`);
            
            // 設置自動刷新
            this.setupAutoRefresh();
            
        } catch (error) {
            this.log(`❌ 保存會話失敗: ${error.message}`);
        }
    }
    
    // 清除存儲的會話
    clearStoredSession() {
        localStorage.removeItem('spotify_session_data');
        localStorage.removeItem('spotify_session_id'); // 清除舊格式
        
        this.sessionId = null;
        this.tokenExpiresAt = null;
        this.refreshToken = null;
        
        this.clearTimers();
        this.log('🗑️ 會話已清除');
    }
    
    // 設置自動 token 刷新
    setupAutoRefresh() {
        this.clearAutoRefreshTimer();
        
        if (!this.tokenExpiresAt) return;
        
        // 在 token 過期前 5 分鐘刷新
        const refreshTime = this.tokenExpiresAt - Date.now() - 5 * 60 * 1000;
        
        if (refreshTime > 0) {
            this.autoRefreshTimer = setTimeout(() => {
                this.log('⏰ 自動刷新 token 時間到');
                this.refreshTokenIfNeeded();
            }, refreshTime);
            
            this.log(`⏰ 自動刷新已設置，${Math.round(refreshTime / 1000 / 60)} 分鐘後執行`);
        } else {
            // token 已經過期或即將過期，立即刷新
            this.log('⚠️ Token 已過期，立即刷新');
            this.scheduleTokenRefresh(0);
        }
    }
    
    // 設置心跳檢測
    setupHeartbeat() {
        this.clearHeartbeatTimer();
        
        // 每 10 分鐘檢查一次會話狀態
        this.heartbeatTimer = setInterval(() => {
            this.performHeartbeat();
        }, 10 * 60 * 1000);
        
        this.log('💓 心跳檢測已啟動 (每 10 分鐘)');
    }
    
    // 執行心跳檢測
    async performHeartbeat() {
        if (!this.sessionId) return;
        
        try {
            this.log('💓 執行心跳檢測...');
            
            const response = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    this.log('💓 心跳檢測正常');
                } else {
                    this.log('⚠️ 心跳檢測：會話無效');
                    this.handleAuthRequired();
                }
            } else if (response.status === 401) {
                this.log('⚠️ 心跳檢測：認證失敗，嘗試刷新 token');
                await this.refreshTokenIfNeeded();
            } else {
                this.log(`⚠️ 心跳檢測失敗: ${response.status}`);
            }
        } catch (error) {
            this.log(`❌ 心跳檢測錯誤: ${error.message}`);
        }
    }
    
    // 處理頁面可見性變化
    setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.sessionId) {
                this.log('👁️ 頁面重新可見，檢查會話狀態');
                // 頁面重新可見時檢查會話
                setTimeout(() => this.performHeartbeat(), 1000);
                
                // 檢查是否需要刷新 token
                if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt - 10 * 60 * 1000) {
                    this.log('⚠️ 頁面重新可見時發現 token 即將過期');
                    this.refreshTokenIfNeeded();
                }
            }
        });
    }
    
    // 刷新 token（如果需要）
    async refreshTokenIfNeeded() {
        if (!this.sessionId) {
            this.log('❌ 沒有 sessionId，無法刷新 token');
            return false;
        }
        
        // 如果正在刷新，返回現有的 Promise
        if (this.isRefreshing && this.refreshPromise) {
            this.log('⏳ Token 正在刷新中，等待完成...');
            return await this.refreshPromise;
        }
        
        // 檢查是否需要刷新（提前 10 分鐘）
        if (this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 10 * 60 * 1000) {
            this.log('✅ Token 仍然有效，無需刷新');
            return true;
        }
        
        this.isRefreshing = true;
        this.refreshPromise = this.performTokenRefresh();
        
        try {
            const result = await this.refreshPromise;
            return result;
        } finally {
            this.isRefreshing = false;
            this.refreshPromise = null;
        }
    }
    
    // 執行 token 刷新
    async performTokenRefresh() {
        this.log('🔄 開始刷新 token...');
        
        try {
            // 使用輕量級的 API 調用來觸發服務端 token 刷新
            const response = await fetch('/api/current-track', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                this.log('✅ Token 刷新成功');
                
                // 更新過期時間（假設刷新後有效期為 1 小時）
                this.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
                this.updateStoredSession();
                this.setupAutoRefresh();
                
                if (this.onTokenRefreshed) {
                    this.onTokenRefreshed();
                }
                
                return true;
            } else if (response.status === 401) {
                this.log('❌ Token 刷新失敗：認證無效');
                this.handleAuthRequired();
                return false;
            } else {
                this.log(`❌ Token 刷新失敗: ${response.status}`);
                return false;
            }
        } catch (error) {
            this.log(`❌ Token 刷新錯誤: ${error.message}`);
            return false;
        }
    }
    
    // 更新存儲的會話信息
    updateStoredSession() {
        if (this.sessionId && this.tokenExpiresAt) {
            try {
                const sessionData = {
                    sessionId: this.sessionId,
                    expiresAt: this.tokenExpiresAt,
                    refreshToken: this.refreshToken,
                    savedAt: Date.now()
                };
                
                localStorage.setItem('spotify_session_data', JSON.stringify(sessionData));
                this.log('✅ 會話信息已更新');
            } catch (error) {
                this.log(`❌ 更新會話信息失敗: ${error.message}`);
            }
        }
    }
    
    // 排程 token 刷新
    scheduleTokenRefresh(delay = 0) {
        setTimeout(() => {
            this.refreshTokenIfNeeded();
        }, delay);
    }
    
    // 處理需要重新認證的情況
    handleAuthRequired() {
        this.log('🔑 需要重新認證');
        this.clearStoredSession();
        
        if (this.onAuthRequired) {
            this.onAuthRequired();
        }
    }
    
    // 帶重試的 API 請求包裝器
    async makeAuthenticatedRequest(url, options = {}) {
        if (!this.sessionId) {
            throw new Error('No session available');
        }
        
        // 確保 token 有效
        const tokenValid = await this.refreshTokenIfNeeded();
        if (!tokenValid) {
            throw new Error('Token refresh failed');
        }
        
        // 添加認證頭
        const headers = {
            ...options.headers,
            'X-Session-Id': this.sessionId
        };
        
        const requestOptions = {
            ...options,
            headers
        };
        
        let lastError;
        
        // 重試邏輯
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const response = await fetch(url, requestOptions);
                
                if (response.status === 401) {
                    this.log(`🔑 請求認證失敗 (嘗試 ${attempt + 1}/${this.maxRetries})`);
                    
                    // 嘗試刷新 token
                    const refreshed = await this.refreshTokenIfNeeded();
                    if (!refreshed) {
                        this.handleAuthRequired();
                        throw new Error('Authentication failed');
                    }
                    
                    // 更新請求頭中的 sessionId
                    requestOptions.headers['X-Session-Id'] = this.sessionId;
                    
                    // 如果不是最後一次嘗試，繼續重試
                    if (attempt < this.maxRetries - 1) {
                        await this.delay(this.baseRetryDelay * Math.pow(2, attempt));
                        continue;
                    }
                }
                
                return response;
                
            } catch (error) {
                lastError = error;
                this.log(`❌ 請求失敗 (嘗試 ${attempt + 1}/${this.maxRetries}): ${error.message}`);
                
                if (attempt < this.maxRetries - 1) {
                    await this.delay(this.baseRetryDelay * Math.pow(2, attempt));
                }
            }
        }
        
        throw lastError || new Error('Request failed after retries');
    }
    
    // 延遲函數
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // 清除定時器
    clearTimers() {
        this.clearAutoRefreshTimer();
        this.clearHeartbeatTimer();
    }
    
    clearAutoRefreshTimer() {
        if (this.autoRefreshTimer) {
            clearTimeout(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }
    }
    
    clearHeartbeatTimer() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    
    // 獲取當前會話狀態
    getSessionStatus() {
        return {
            hasSession: !!this.sessionId,
            sessionId: this.sessionId,
            expiresAt: this.tokenExpiresAt,
            isExpired: this.tokenExpiresAt ? Date.now() >= this.tokenExpiresAt : false,
            expiresInMinutes: this.tokenExpiresAt ? Math.max(0, Math.round((this.tokenExpiresAt - Date.now()) / 1000 / 60)) : 0
        };
    }
    
    // 手動觸發認證流程
    triggerAuth() {
        this.log('🔗 手動觸發認證流程');
        window.location.href = '/api/auth';
    }
    
    // 銷毀管理器
    destroy() {
        this.clearTimers();
        this.log('🗑️ Token 管理器已銷毀');
    }
}

// 導出給其他模塊使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedTokenManager;
} else if (typeof window !== 'undefined') {
    window.EnhancedTokenManager = EnhancedTokenManager;
}