// 高級自動更新系統 - 全面的 Token、Session 和數據管理
// Advanced Auto-Updater System - Comprehensive Token, Session and Data Management

class AdvancedAutoUpdater {
    constructor() {
        this.isActive = false;
        this.updateIntervals = new Map();
        this.lastUpdateTimes = new Map();
        this.retryCounters = new Map();
        this.maxRetries = 3;
        this.backoffMultiplier = 2;
        
        // 更新配置
        this.updateConfig = {
            token: {
                interval: 30 * 60 * 1000, // 30分鐘檢查一次
                preemptiveTime: 5 * 60 * 1000, // 提前5分鐘刷新
                enabled: true
            },
            session: {
                interval: 10 * 60 * 1000, // 10分鐘檢查一次
                enabled: true
            },
            userProfile: {
                interval: 60 * 60 * 1000, // 1小時更新一次
                enabled: true
            },
            devices: {
                interval: 2 * 60 * 1000, // 2分鐘更新一次
                enabled: true
            },
            playbackState: {
                interval: 5 * 1000, // 5秒更新一次（播放時）
                pausedInterval: 30 * 1000, // 暫停時30秒更新一次
                enabled: true
            },
            queue: {
                interval: 30 * 1000, // 30秒更新一次
                enabled: true
            },
            likedSongs: {
                interval: 5 * 60 * 1000, // 5分鐘更新一次
                enabled: false // 按需更新
            }
        };
        
        // 數據緩存
        this.cache = {
            token: null,
            session: null,
            userProfile: null,
            devices: [],
            playbackState: null,
            queue: [],
            likedSongs: new Set()
        };
        
        // 事件監聽器
        this.listeners = {
            onTokenUpdated: null,
            onSessionUpdated: null,
            onUserProfileUpdated: null,
            onDevicesUpdated: null,
            onPlaybackStateUpdated: null,
            onQueueUpdated: null,
            onLikedSongsUpdated: null,
            onError: null,
            onStatusChange: null
        };
        
        this.log = (message, type = 'info') => {
            const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            console.log(`[${timestamp}] [AutoUpdater] ${message}`);
        };
        
        this.sessionId = null;
        this.isPlaying = false;
        this.lastTrackId = null;
        
        this.init();
    }
    
    init() {
        this.log('🚀 高級自動更新系統初始化...');
        this.loadStoredData();
        this.setupVisibilityHandling();
        this.setupNetworkHandling();
    }
    
    // 載入存儲的數據
    loadStoredData() {
        try {
            // 載入 Token 和 Session
            const storedSession = localStorage.getItem('spotify_session_data');
            if (storedSession) {
                const sessionData = JSON.parse(storedSession);
                this.sessionId = sessionData.sessionId;
                this.cache.token = {
                    accessToken: sessionData.accessToken,
                    expiresAt: sessionData.expiresAt,
                    refreshToken: sessionData.refreshToken
                };
                this.cache.session = sessionData;
                this.log('✅ 從存儲載入 Token 和 Session');
            }
            
            // 載入用戶資料
            const storedProfile = localStorage.getItem('spotify_user_profile');
            if (storedProfile) {
                this.cache.userProfile = JSON.parse(storedProfile);
                this.log('✅ 從存儲載入用戶資料');
            }
            
            // 載入設備列表
            const storedDevices = localStorage.getItem('spotify_devices');
            if (storedDevices) {
                this.cache.devices = JSON.parse(storedDevices);
                this.log('✅ 從存儲載入設備列表');
            }
            
            // 載入喜歡的歌曲
            const storedLikedSongs = localStorage.getItem('spotify_liked_songs');
            if (storedLikedSongs) {
                this.cache.likedSongs = new Set(JSON.parse(storedLikedSongs));
                this.log('✅ 從存儲載入喜歡的歌曲');
            }
            
        } catch (error) {
            this.log(`❌ 載入存儲數據失敗: ${error.message}`, 'error');
        }
    }
    
    // 保存數據到存儲
    saveToStorage(type, data) {
        try {
            switch (type) {
                case 'session':
                    localStorage.setItem('spotify_session_data', JSON.stringify(data));
                    break;
                case 'userProfile':
                    localStorage.setItem('spotify_user_profile', JSON.stringify(data));
                    break;
                case 'devices':
                    localStorage.setItem('spotify_devices', JSON.stringify(data));
                    break;
                case 'likedSongs':
                    localStorage.setItem('spotify_liked_songs', JSON.stringify(Array.from(data)));
                    break;
            }
        } catch (error) {
            this.log(`❌ 保存 ${type} 數據失敗: ${error.message}`, 'error');
        }
    }
    
    // 啟動自動更新
    start(sessionId) {
        if (this.isActive) {
            this.log('⚠️ 自動更新已在運行中');
            return;
        }
        
        this.sessionId = sessionId;
        this.isActive = true;
        this.log('🟢 啟動自動更新系統');
        
        // 立即執行一次完整更新
        this.performFullUpdate();
        
        // 設置定期更新
        this.setupPeriodicUpdates();
        
        // 通知狀態變化
        this.notifyStatusChange('started');
    }
    
    // 停止自動更新
    stop() {
        if (!this.isActive) return;
        
        this.isActive = false;
        this.log('🔴 停止自動更新系統');
        
        // 清除所有定時器
        this.updateIntervals.forEach((intervalId, type) => {
            clearInterval(intervalId);
        });
        this.updateIntervals.clear();
        
        // 通知狀態變化
        this.notifyStatusChange('stopped');
    }
    
    // 執行完整更新
    async performFullUpdate() {
        this.log('🔄 執行完整數據更新...');
        
        const updatePromises = [];
        
        if (this.updateConfig.token.enabled) {
            updatePromises.push(this.updateToken());
        }
        if (this.updateConfig.session.enabled) {
            updatePromises.push(this.updateSession());
        }
        if (this.updateConfig.userProfile.enabled) {
            updatePromises.push(this.updateUserProfile());
        }
        if (this.updateConfig.devices.enabled) {
            updatePromises.push(this.updateDevices());
        }
        if (this.updateConfig.playbackState.enabled) {
            updatePromises.push(this.updatePlaybackState());
        }
        if (this.updateConfig.queue.enabled) {
            updatePromises.push(this.updateQueue());
        }
        
        try {
            await Promise.allSettled(updatePromises);
            this.log('✅ 完整更新完成');
        } catch (error) {
            this.log(`❌ 完整更新失敗: ${error.message}`, 'error');
        }
    }
    
    // 設置定期更新
    setupPeriodicUpdates() {
        // Token 更新
        if (this.updateConfig.token.enabled) {
            const tokenInterval = setInterval(() => {
                this.updateToken();
            }, this.updateConfig.token.interval);
            this.updateIntervals.set('token', tokenInterval);
        }
        
        // Session 更新
        if (this.updateConfig.session.enabled) {
            const sessionInterval = setInterval(() => {
                this.updateSession();
            }, this.updateConfig.session.interval);
            this.updateIntervals.set('session', sessionInterval);
        }
        
        // 用戶資料更新
        if (this.updateConfig.userProfile.enabled) {
            const profileInterval = setInterval(() => {
                this.updateUserProfile();
            }, this.updateConfig.userProfile.interval);
            this.updateIntervals.set('userProfile', profileInterval);
        }
        
        // 設備列表更新
        if (this.updateConfig.devices.enabled) {
            const devicesInterval = setInterval(() => {
                this.updateDevices();
            }, this.updateConfig.devices.interval);
            this.updateIntervals.set('devices', devicesInterval);
        }
        
        // 播放狀態更新（動態間隔）
        if (this.updateConfig.playbackState.enabled) {
            this.setupDynamicPlaybackUpdates();
        }
        
        // 隊列更新
        if (this.updateConfig.queue.enabled) {
            const queueInterval = setInterval(() => {
                this.updateQueue();
            }, this.updateConfig.queue.interval);
            this.updateIntervals.set('queue', queueInterval);
        }
    }
    
    // 動態播放狀態更新
    setupDynamicPlaybackUpdates() {
        const updatePlayback = () => {
            this.updatePlaybackState().then(() => {
                // 根據播放狀態調整更新頻率
                const interval = this.isPlaying ? 
                    this.updateConfig.playbackState.interval : 
                    this.updateConfig.playbackState.pausedInterval;
                
                setTimeout(updatePlayback, interval);
            });
        };
        
        updatePlayback();
    }
    
    // 更新 Token
    async updateToken() {
        if (!this.sessionId) return;
        
        try {
            const now = Date.now();
            const token = this.cache.token;
            
            // 檢查是否需要刷新
            if (token && token.expiresAt && 
                now < token.expiresAt - this.updateConfig.token.preemptiveTime) {
                return; // Token 仍然有效
            }
            
            this.log('🔄 更新 Token...');
            
            // 嘗試刷新 Token
            const response = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    // 更新 Token 信息（假設服務端已刷新）
                    if (this.cache.token) {
                        this.cache.token.expiresAt = now + 60 * 60 * 1000; // 假設1小時有效期
                    }
                    
                    this.log('✅ Token 更新成功');
                    this.notifyListener('onTokenUpdated', this.cache.token);
                    this.resetRetryCounter('token');
                } else {
                    throw new Error('Token 無效');
                }
            } else {
                throw new Error(`Token 更新失敗: ${response.status}`);
            }
            
        } catch (error) {
            this.log(`❌ Token 更新失敗: ${error.message}`, 'error');
            this.handleUpdateError('token', error);
        }
    }
    
    // 更新 Session
    async updateSession() {
        if (!this.sessionId) return;
        
        try {
            this.log('🔄 更新 Session...');
            
            const response = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.cache.session = { ...this.cache.session, ...data };
                this.saveToStorage('session', this.cache.session);
                
                this.log('✅ Session 更新成功');
                this.notifyListener('onSessionUpdated', this.cache.session);
                this.resetRetryCounter('session');
            } else {
                throw new Error(`Session 更新失敗: ${response.status}`);
            }
            
        } catch (error) {
            this.log(`❌ Session 更新失敗: ${error.message}`, 'error');
            this.handleUpdateError('session', error);
        }
    }
    
    // 更新用戶資料
    async updateUserProfile() {
        if (!this.sessionId) return;
        
        try {
            this.log('🔄 更新用戶資料...');
            
            const response = await fetch('/api/current-track', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.is_premium !== undefined) {
                    const profile = {
                        isPremium: data.is_premium,
                        lastUpdated: Date.now()
                    };
                    
                    this.cache.userProfile = { ...this.cache.userProfile, ...profile };
                    this.saveToStorage('userProfile', this.cache.userProfile);
                    
                    this.log('✅ 用戶資料更新成功');
                    this.notifyListener('onUserProfileUpdated', this.cache.userProfile);
                    this.resetRetryCounter('userProfile');
                }
            } else {
                throw new Error(`用戶資料更新失敗: ${response.status}`);
            }
            
        } catch (error) {
            this.log(`❌ 用戶資料更新失敗: ${error.message}`, 'error');
            this.handleUpdateError('userProfile', error);
        }
    }
    
    // 更新設備列表
    async updateDevices() {
        if (!this.sessionId) return;
        
        try {
            this.log('🔄 更新設備列表...');
            
            const response = await fetch('/api/devices', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.cache.devices = data.devices || [];
                this.saveToStorage('devices', this.cache.devices);
                
                this.log(`✅ 設備列表更新成功 (${this.cache.devices.length} 個設備)`);
                this.notifyListener('onDevicesUpdated', this.cache.devices);
                this.resetRetryCounter('devices');
            } else {
                throw new Error(`設備列表更新失敗: ${response.status}`);
            }
            
        } catch (error) {
            this.log(`❌ 設備列表更新失敗: ${error.message}`, 'error');
            this.handleUpdateError('devices', error);
        }
    }
    
    // 更新播放狀態
    async updatePlaybackState() {
        if (!this.sessionId) return;
        
        try {
            const response = await fetch('/api/current-track', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // 檢查播放狀態變化
                const wasPlaying = this.isPlaying;
                this.isPlaying = data.isPlaying || false;
                
                // 檢查歌曲變化
                const trackChanged = this.lastTrackId !== data.id;
                this.lastTrackId = data.id;
                
                this.cache.playbackState = {
                    ...data,
                    lastUpdated: Date.now()
                };
                
                if (wasPlaying !== this.isPlaying || trackChanged) {
                    this.log(`🎵 播放狀態變化: ${this.isPlaying ? '播放' : '暫停'} ${trackChanged ? '(新歌曲)' : ''}`);
                }
                
                this.notifyListener('onPlaybackStateUpdated', this.cache.playbackState);
                this.resetRetryCounter('playbackState');
                
                // 如果歌曲變化，更新喜歡狀態
                if (trackChanged && data.id) {
                    this.updateTrackLikeStatus(data.id);
                }
                
            } else {
                throw new Error(`播放狀態更新失敗: ${response.status}`);
            }
            
        } catch (error) {
            this.log(`❌ 播放狀態更新失敗: ${error.message}`, 'error');
            this.handleUpdateError('playbackState', error);
        }
    }
    
    // 更新隊列
    async updateQueue() {
        if (!this.sessionId) return;
        
        try {
            const response = await fetch('/api/player/queue', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.cache.queue = data.queue || [];
                
                this.log(`🎵 隊列更新成功 (${this.cache.queue.length} 首歌曲)`);
                this.notifyListener('onQueueUpdated', this.cache.queue);
                this.resetRetryCounter('queue');
            } else {
                throw new Error(`隊列更新失敗: ${response.status}`);
            }
            
        } catch (error) {
            this.log(`❌ 隊列更新失敗: ${error.message}`, 'error');
            this.handleUpdateError('queue', error);
        }
    }
    
    // 更新歌曲喜歡狀態
    async updateTrackLikeStatus(trackId) {
        if (!this.sessionId || !trackId) return;
        
        try {
            const response = await fetch(`/api/library/check/${trackId}`, {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.isLiked) {
                    this.cache.likedSongs.add(trackId);
                } else {
                    this.cache.likedSongs.delete(trackId);
                }
                
                this.saveToStorage('likedSongs', this.cache.likedSongs);
                this.notifyListener('onLikedSongsUpdated', {
                    trackId,
                    isLiked: data.isLiked,
                    likedSongs: this.cache.likedSongs
                });
            }
            
        } catch (error) {
            this.log(`❌ 歌曲喜歡狀態更新失敗: ${error.message}`, 'error');
        }
    }
    
    // 處理更新錯誤
    handleUpdateError(type, error) {
        const retryCount = this.retryCounters.get(type) || 0;
        
        if (retryCount < this.maxRetries) {
            const delay = Math.pow(this.backoffMultiplier, retryCount) * 1000;
            this.retryCounters.set(type, retryCount + 1);
            
            this.log(`⏳ ${type} 更新失敗，${delay}ms 後重試 (${retryCount + 1}/${this.maxRetries})`);
            
            setTimeout(() => {
                switch (type) {
                    case 'token': this.updateToken(); break;
                    case 'session': this.updateSession(); break;
                    case 'userProfile': this.updateUserProfile(); break;
                    case 'devices': this.updateDevices(); break;
                    case 'playbackState': this.updatePlaybackState(); break;
                    case 'queue': this.updateQueue(); break;
                }
            }, delay);
        } else {
            this.log(`❌ ${type} 更新達到最大重試次數，暫停更新`, 'error');
            this.notifyListener('onError', { type, error, maxRetriesReached: true });
        }
    }
    
    // 重置重試計數器
    resetRetryCounter(type) {
        this.retryCounters.delete(type);
    }
    
    // 通知監聽器
    notifyListener(eventType, data) {
        const listener = this.listeners[eventType];
        if (listener && typeof listener === 'function') {
            try {
                listener(data);
            } catch (error) {
                this.log(`❌ 監聽器 ${eventType} 執行失敗: ${error.message}`, 'error');
            }
        }
    }
    
    // 通知狀態變化
    notifyStatusChange(status) {
        this.notifyListener('onStatusChange', {
            status,
            timestamp: Date.now(),
            isActive: this.isActive
        });
    }
    
    // 設置頁面可見性處理
    setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isActive) {
                this.log('👁️ 頁面重新可見，執行快速更新');
                this.performQuickUpdate();
            }
        });
    }
    
    // 設置網絡狀態處理
    setupNetworkHandling() {
        window.addEventListener('online', () => {
            if (this.isActive) {
                this.log('🌐 網絡重新連接，執行完整更新');
                this.performFullUpdate();
            }
        });
        
        window.addEventListener('offline', () => {
            this.log('📴 網絡斷開連接');
        });
    }
    
    // 執行快速更新
    async performQuickUpdate() {
        const quickUpdates = [
            this.updatePlaybackState(),
            this.updateSession()
        ];
        
        try {
            await Promise.allSettled(quickUpdates);
            this.log('✅ 快速更新完成');
        } catch (error) {
            this.log(`❌ 快速更新失敗: ${error.message}`, 'error');
        }
    }
    
    // 獲取緩存數據
    getCachedData(type) {
        return this.cache[type];
    }
    
    // 獲取系統狀態
    getStatus() {
        return {
            isActive: this.isActive,
            sessionId: this.sessionId,
            lastUpdateTimes: Object.fromEntries(this.lastUpdateTimes),
            retryCounters: Object.fromEntries(this.retryCounters),
            cacheStatus: {
                token: !!this.cache.token,
                session: !!this.cache.session,
                userProfile: !!this.cache.userProfile,
                devices: this.cache.devices.length,
                playbackState: !!this.cache.playbackState,
                queue: this.cache.queue.length,
                likedSongs: this.cache.likedSongs.size
            }
        };
    }
    
    // 設置監聽器
    on(eventType, callback) {
        if (this.listeners.hasOwnProperty(`on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`)) {
            this.listeners[`on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`] = callback;
        }
    }
    
    // 移除監聽器
    off(eventType) {
        if (this.listeners.hasOwnProperty(`on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`)) {
            this.listeners[`on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`] = null;
        }
    }
    
    // 更新配置
    updateConfig(newConfig) {
        this.updateConfig = { ...this.updateConfig, ...newConfig };
        this.log('⚙️ 更新配置已應用');
        
        if (this.isActive) {
            this.log('🔄 重啟更新系統以應用新配置');
            this.stop();
            setTimeout(() => this.start(this.sessionId), 1000);
        }
    }
    
    // 銷毀
    destroy() {
        this.stop();
        this.cache = {};
        this.listeners = {};
        this.log('🗑️ 高級自動更新系統已銷毀');
    }
}

// 導出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdvancedAutoUpdater;
} else if (typeof window !== 'undefined') {
    window.AdvancedAutoUpdater = AdvancedAutoUpdater;
}