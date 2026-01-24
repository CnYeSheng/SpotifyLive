// 整合增強認證系統到現有播放器
// Integration script for Enhanced Authentication System

// 修改現有的 SpotifyLyricsPlayer 類以使用增強的 token 管理
function integrateEnhancedAuth() {
    // 確保 EnhancedTokenManager 已載入
    if (typeof EnhancedTokenManager === 'undefined') {
        console.error('❌ EnhancedTokenManager 未載入');
        return;
    }

    // 保存原始的 SpotifyLyricsPlayer 類
    const OriginalSpotifyLyricsPlayer = window.SpotifyLyricsPlayer;
    
    if (!OriginalSpotifyLyricsPlayer) {
        console.error('❌ SpotifyLyricsPlayer 類未找到');
        return;
    }

    // 創建增強版的 SpotifyLyricsPlayer
    class EnhancedSpotifyLyricsPlayer extends OriginalSpotifyLyricsPlayer {
        constructor() {
            super();
            
            // 初始化增強的 token 管理器
            this.tokenManager = new EnhancedTokenManager();
            
            // 設置事件監聽器
            this.tokenManager.onTokenRefreshed = () => {
                this.log('✅ Token 已自動刷新');
                // 可以在這裡添加 UI 提示
                this.showSuccessMessage('🔄 連接已自動更新');
            };
            
            this.tokenManager.onAuthRequired = () => {
                this.log('🔑 需要重新認證');
                this.showAuthSection();
                this.stopTracking();
            };
            
            this.tokenManager.onError = (error) => {
                this.log(`❌ Token 管理錯誤: ${error.message}`);
                this.showErrorMessage('認證系統錯誤: ' + error.message);
            };
            
            // 覆蓋 sessionId 獲取邏輯
            this.sessionId = this.tokenManager.sessionId;
            
            this.log('✅ 增強認證系統已啟動');
        }
        
        // 覆蓋原始的認證回調處理
        handleAuthCallback() {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('auth') === 'success') {
                const sessionId = urlParams.get('session');
                if (sessionId) {
                    // 使用增強的 token 管理器保存會話
                    const expiresAt = Date.now() + 60 * 60 * 1000; // 假設 1 小時有效期
                    this.tokenManager.saveSession(sessionId, expiresAt, null);
                    this.sessionId = sessionId;
                    
                    this.log(`✅ 新會話已通過增強系統保存: ${sessionId.substring(0, 8)}...`);
                }
                window.history.replaceState({}, document.title, window.location.pathname);
                this.showSuccessMessage('🎉 Spotify 連接成功！');
            } else {
                // 嘗試從增強的 token 管理器恢復會話
                if (this.tokenManager.sessionId) {
                    this.sessionId = this.tokenManager.sessionId;
                    this.log(`🔄 從增強系統恢復會話: ${this.sessionId.substring(0, 8)}...`);
                } else {
                    this.log('❌ 沒有找到保存的會話');
                }
            }
        }
        
        // 覆蓋認證狀態檢查
        async checkAuthStatus() {
            try {
                const status = this.tokenManager.getSessionStatus();
                
                if (!status.hasSession) {
                    this.log('❌ 沒有有效會話，顯示登入頁面');
                    this.showAuthSection();
                    return;
                }
                
                this.sessionId = this.tokenManager.sessionId;
                this.log(`🔍 使用增強系統檢查認證狀態: ${this.sessionId.substring(0, 8)}...`);
                
                // 使用增強的請求方法
                const response = await this.tokenManager.makeAuthenticatedRequest('/api/auth-status');
                const data = await response.json();
                
                if (data.authenticated) {
                    this.log('✅ 認證狀態有效，啟動播放器');
                    this.showPlayerSection();
                    this.startTracking();
                } else {
                    this.log('❌ 認證狀態無效');
                    this.tokenManager.handleAuthRequired();
                }
            } catch (error) {
                this.log(`❌ 檢查認證狀態失敗: ${error.message}`);
                this.showAuthSection();
            }
        }
        
        // 覆蓋認證錯誤處理
        async handleAuthError() {
            this.log('🔍 使用增強系統處理認證錯誤...');
            
            try {
                // 使用增強的 token 管理器處理認證錯誤
                const refreshed = await this.tokenManager.refreshTokenIfNeeded();
                
                if (refreshed) {
                    this.sessionId = this.tokenManager.sessionId;
                    this.log('✅ 認證錯誤已通過增強系統修復');
                    return true;
                } else {
                    this.log('❌ 增強系統無法修復認證錯誤');
                    this.tokenManager.handleAuthRequired();
                    return false;
                }
            } catch (error) {
                this.log(`❌ 增強系統認證處理失敗: ${error.message}`);
                this.tokenManager.handleAuthRequired();
                return false;
            }
        }
        
        // 覆蓋 API 請求方法以使用增強的認證
        async makeAuthenticatedAPICall(url, options = {}) {
            try {
                return await this.tokenManager.makeAuthenticatedRequest(url, options);
            } catch (error) {
                this.log(`❌ 增強 API 請求失敗: ${error.message}`);
                throw error;
            }
        }
        
        // 覆蓋當前歌曲檢查以使用增強認證
        async checkCurrentTrack() {
            if (this.isCheckingTrack) {
                return;
            }
            
            this.isCheckingTrack = true;
            
            try {
                const response = await this.makeAuthenticatedAPICall(`${this.apiBase}/api/current-track`);
                
                if (!response.ok) {
                    console.error(`API 錯誤: ${response.status} ${response.statusText}`);
                    if (response.status >= 500) {
                        console.log('服務器錯誤，稍後重試...');
                        this.scheduleRetry(5000);
                    }
                    this.updateStatus('spotify', false);
                    return;
                }

                const data = await response.json();
                
                // 重置重試計數器
                this.retryCount = 0;
                
                if (!data.name) {
                    this.showNoMusicSection();
                    return;
                }

                const isNewTrack = !this.currentTrack || 
                                  this.currentTrack.id !== data.id ||
                                  this.currentTrack.name !== data.name;

                this.currentTrack = data;
                this.currentTrack.lastUpdated = Date.now();
                
                if (isNewTrack) {
                    this.log('🎵 新歌曲，更新所有信息');
                    this.updateTrackInfo();
                    this.lyrics = [];
                    setTimeout(() => {
                        this.loadLyrics();
                    }, 1500);
                    this.currentLyricsTrackId = null;
                    this.isLoadingLyrics = false;
                    this.safeLyricsLoad();
                }
                
                this.updateNextTrackPreview();
                this.updatePlayerControls();
                this.updateProgress();
                this.showPlayerSection();
                this.updateStatus('spotify', true);
                
                const remainingTime = this.currentTrack.duration - this.currentTrack.progress;
                const wasNearEnd = this.isNearTrackEnd;
                this.isNearTrackEnd = remainingTime <= 10000;
                
                if (wasNearEnd !== this.isNearTrackEnd) {
                    this.adjustPollingInterval();
                }
                
                this.retryCount = 0;
                if (this.rateLimitCount > 0) {
                    this.rateLimitCount = Math.max(0, this.rateLimitCount - 1);
                }

            } catch (error) {
                this.log(`❌ 獲取當前播放失敗: ${error.message}`);
                this.updateStatus('spotify', false);
            } finally {
                this.isCheckingTrack = false;
            }
        }
        
        // 覆蓋停止追蹤以清理增強系統
        stopTracking() {
            super.stopTracking();
            // 不銷毀 token 管理器，只是停止播放器追蹤
        }
        
        // 添加會話狀態顯示方法
        showSessionStatus() {
            const status = this.tokenManager.getSessionStatus();
            const statusInfo = {
                '會話ID': status.sessionId ? status.sessionId.substring(0, 8) + '...' : '無',
                '會話狀態': status.hasSession ? '有效' : '無效',
                '過期時間': status.expiresAt ? new Date(status.expiresAt).toLocaleString('zh-TW') : '未知',
                '剩餘時間': status.expiresInMinutes + ' 分鐘',
                '是否過期': status.isExpired ? '是' : '否'
            };
            
            console.table(statusInfo);
            return statusInfo;
        }
        
        // 添加手動刷新 token 的方法
        async manualRefreshToken() {
            this.log('🔄 手動觸發 token 刷新...');
            try {
                const result = await this.tokenManager.refreshTokenIfNeeded();
                if (result) {
                    this.showSuccessMessage('✅ Token 刷新成功');
                    this.sessionId = this.tokenManager.sessionId;
                } else {
                    this.showErrorMessage('❌ Token 刷新失敗');
                }
                return result;
            } catch (error) {
                this.log(`❌ 手動刷新失敗: ${error.message}`);
                this.showErrorMessage('Token 刷新錯誤: ' + error.message);
                return false;
            }
        }
        
        // 銷毀方法
        destroy() {
            if (this.tokenManager) {
                this.tokenManager.destroy();
            }
            this.stopTracking();
            this.log('🗑️ 增強播放器已銷毀');
        }
    }
    
    // 替換全局的 SpotifyLyricsPlayer 類
    window.SpotifyLyricsPlayer = EnhancedSpotifyLyricsPlayer;
    
    console.log('✅ 增強認證系統整合完成');
    
    // 如果已經有播放器實例，重新創建
    if (window.spotifyPlayer) {
        const oldPlayer = window.spotifyPlayer;
        oldPlayer.destroy?.();
        
        // 創建新的增強播放器實例
        window.spotifyPlayer = new EnhancedSpotifyLyricsPlayer();
        
        console.log('✅ 播放器實例已升級為增強版本');
    }
}

// 自動整合（如果環境允許）
if (typeof window !== 'undefined' && window.document) {
    // 等待 DOM 和其他腳本載入完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(integrateEnhancedAuth, 100);
        });
    } else {
        setTimeout(integrateEnhancedAuth, 100);
    }
}

// 導出整合函數
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { integrateEnhancedAuth };
} else if (typeof window !== 'undefined') {
    window.integrateEnhancedAuth = integrateEnhancedAuth;
}

// 添加調試方法到控制台
if (typeof window !== 'undefined') {
    window.debugAuth = {
        showStatus: () => {
            if (window.spotifyPlayer && window.spotifyPlayer.showSessionStatus) {
                return window.spotifyPlayer.showSessionStatus();
            } else {
                console.log('❌ 增強播放器未初始化');
            }
        },
        refreshToken: () => {
            if (window.spotifyPlayer && window.spotifyPlayer.manualRefreshToken) {
                return window.spotifyPlayer.manualRefreshToken();
            } else {
                console.log('❌ 增強播放器未初始化');
            }
        },
        clearSession: () => {
            if (window.spotifyPlayer && window.spotifyPlayer.tokenManager) {
                window.spotifyPlayer.tokenManager.clearStoredSession();
                console.log('✅ 會話已清除');
            } else {
                console.log('❌ 增強播放器未初始化');
            }
        }
    };
    
    console.log('🔧 調試工具已載入，使用 window.debugAuth 訪問');
}