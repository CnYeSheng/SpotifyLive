// 整合高級自動更新系統到 Spotify 播放器
// Integration script for Advanced Auto-Updater System

function integrateAdvancedUpdater() {
    // 確保依賴已載入
    if (typeof AdvancedAutoUpdater === 'undefined') {
        console.error('❌ AdvancedAutoUpdater 未載入');
        return;
    }

    // 保存原始的 SpotifyLyricsPlayer 類
    const OriginalSpotifyLyricsPlayer = window.SpotifyLyricsPlayer;
    
    if (!OriginalSpotifyLyricsPlayer) {
        console.error('❌ SpotifyLyricsPlayer 類未找到');
        return;
    }

    // 創建增強版的 SpotifyLyricsPlayer
    class SuperEnhancedSpotifyLyricsPlayer extends OriginalSpotifyLyricsPlayer {
        constructor() {
            super();
            
            // 初始化高級自動更新系統
            this.autoUpdater = new AdvancedAutoUpdater();
            
            // 設置自動更新事件監聽器
            this.setupAutoUpdaterListeners();
            
            // 覆蓋原有的更新邏輯
            this.setupSmartUpdating();
            
            this.log('✅ 高級自動更新系統已整合');
        }
        
        // 設置自動更新監聽器
        setupAutoUpdaterListeners() {
            // Token 更新監聽
            this.autoUpdater.on('tokenUpdated', (tokenData) => {
                this.log('🔄 Token 已自動更新');
                this.showSuccessMessage('🔐 認證已自動更新');
            });
            
            // Session 更新監聽
            this.autoUpdater.on('sessionUpdated', (sessionData) => {
                this.log('🔄 Session 已自動更新');
                // 更新本地 sessionId
                if (sessionData.sessionId && sessionData.sessionId !== this.sessionId) {
                    this.sessionId = sessionData.sessionId;
                }
            });
            
            // 用戶資料更新監聽
            this.autoUpdater.on('userProfileUpdated', (profileData) => {
                this.log('👤 用戶資料已更新');
                if (profileData.isPremium !== undefined) {
                    this.isPremium = profileData.isPremium;
                    this.updatePremiumButtons();
                }
            });
            
            // 設備列表更新監聽
            this.autoUpdater.on('devicesUpdated', (devices) => {
                this.log(`📱 設備列表已更新 (${devices.length} 個設備)`);
                this.cachedDevices = devices;
                this.updateDeviceInfo(devices);
            });
            
            // 播放狀態更新監聽
            this.autoUpdater.on('playbackStateUpdated', (playbackData) => {
                if (playbackData.name) {
                    this.handleAutoPlaybackUpdate(playbackData);
                }
            });
            
            // 隊列更新監聽
            this.autoUpdater.on('queueUpdated', (queueData) => {
                this.log(`🎵 隊列已更新 (${queueData.length} 首歌曲)`);
                this.cachedQueue = queueData;
                this.updateQueueDisplay();
            });
            
            // 喜歡歌曲更新監聽
            this.autoUpdater.on('likedSongsUpdated', (likeData) => {
                if (likeData.trackId === this.currentTrack?.id) {
                    this.updateLikeButtonState(likeData.isLiked);
                }
            });
            
            // 錯誤處理監聽
            this.autoUpdater.on('error', (errorData) => {
                this.log(`❌ 自動更新錯誤 (${errorData.type}): ${errorData.error.message}`);
                if (errorData.maxRetriesReached) {
                    this.showErrorMessage(`${errorData.type} 自動更新失敗，請檢查網絡連接`);
                }
            });
            
            // 狀態變化監聽
            this.autoUpdater.on('statusChange', (statusData) => {
                this.log(`📊 自動更新系統狀態: ${statusData.status}`);
                if (statusData.status === 'started') {
                    this.showSuccessMessage('🚀 自動更新系統已啟動');
                }
            });
        }
        
        // 設置智能更新
        setupSmartUpdating() {
            // 禁用原有的定期更新，使用自動更新系統
            this.useAutoUpdater = true;
            
            // 調整自動更新配置
            this.autoUpdater.updateConfig({
                playbackState: {
                    interval: 3000, // 3秒更新播放狀態
                    pausedInterval: 15000, // 暫停時15秒更新
                    enabled: true
                },
                devices: {
                    interval: 60000, // 1分鐘更新設備
                    enabled: true
                },
                queue: {
                    interval: 20000, // 20秒更新隊列
                    enabled: true
                }
            });
        }
        
        // 處理自動播放狀態更新
        handleAutoPlaybackUpdate(playbackData) {
            const isNewTrack = !this.currentTrack || 
                              this.currentTrack.id !== playbackData.id ||
                              this.currentTrack.name !== playbackData.name;

            // 更新當前歌曲數據
            this.currentTrack = playbackData;
            this.currentTrack.lastUpdated = Date.now();
            
            if (isNewTrack) {
                this.log('🎵 自動檢測到新歌曲');
                this.handleNewTrackFromAutoUpdate();
            }
            
            // 更新 UI
            this.updatePlayerControls();
            this.updateProgress();
            this.showPlayerSection();
            this.updateStatus('spotify', true);
        }
        
        // 處理自動更新檢測到的新歌曲
        handleNewTrackFromAutoUpdate() {
            this.updateTrackInfo();
            
            // 重置歌詞狀態
            this.lyrics = [];
            this.currentLyricsTrackId = null;
            this.isLoadingLyrics = false;
            
            // 清除之前的歌詞載入請求
            if (this.lyricsLoadTimeout) {
                clearTimeout(this.lyricsLoadTimeout);
                this.lyricsLoadTimeout = null;
            }
            
            // 載入新歌詞
            this.safeLyricsLoad();
        }
        
        // 更新設備信息顯示
        updateDeviceInfo(devices) {
            if (!devices || devices.length === 0) return;
            
            const activeDevice = devices.find(device => device.is_active);
            if (activeDevice && this.deviceInfo) {
                this.deviceName.textContent = `${activeDevice.name} (${activeDevice.type})`;
                this.deviceInfo.style.display = 'block';
                
                if (activeDevice.volume_percent !== null && this.volumeSlider) {
                    this.volumeSlider.value = activeDevice.volume_percent;
                    this.volumeValue.textContent = `${activeDevice.volume_percent}%`;
                }
            }
        }
        
        // 更新隊列顯示
        updateQueueDisplay() {
            if (this.cachedQueue && this.currentTrack) {
                // 更新下一首預覽
                const nextTrack = this.cachedQueue[0];
                if (nextTrack && this.nextTrackName) {
                    this.nextTrackName.textContent = `${nextTrack.artist} - ${nextTrack.name}`;
                }
            }
        }
        
        // 覆蓋原有的認證檢查
        async checkAuthStatus() {
            try {
                const status = this.autoUpdater.getCachedData('session');
                
                if (!status || !this.sessionId) {
                    this.log('❌ 沒有有效會話，顯示登入頁面');
                    this.showAuthSection();
                    return;
                }
                
                this.log('✅ 使用緩存的認證狀態');
                this.showPlayerSection();
                this.startAutoUpdater();
                
            } catch (error) {
                this.log(`❌ 檢查認證狀態失敗: ${error.message}`);
                this.showAuthSection();
            }
        }
        
        // 啟動自動更新系統
        startAutoUpdater() {
            if (this.sessionId && !this.autoUpdater.isActive) {
                this.autoUpdater.start(this.sessionId);
                this.log('🚀 自動更新系統已啟動');
            }
        }
        
        // 覆蓋原有的追蹤啟動
        startTracking() {
            // 使用自動更新系統而不是原有的定期檢查
            this.startAutoUpdater();
            
            // 執行一次立即檢查
            this.checkCurrentTrackWithRateLimit();
        }
        
        // 覆蓋原有的追蹤停止
        stopTracking() {
            super.stopTracking();
            
            if (this.autoUpdater) {
                this.autoUpdater.stop();
                this.log('🛑 自動更新系統已停止');
            }
        }
        
        // 覆蓋設備列表獲取
        async showDevicesModal() {
            this.devicesModal.style.display = 'flex';
            this.devicesContent.innerHTML = '<div class="loading">載入中...</div>';

            // 優先使用緩存的設備列表
            const cachedDevices = this.autoUpdater.getCachedData('devices');
            if (cachedDevices && cachedDevices.length > 0) {
                this.displayDevices(cachedDevices);
                return;
            }

            // 如果沒有緩存，手動更新
            try {
                await this.autoUpdater.updateDevices();
                const devices = this.autoUpdater.getCachedData('devices');
                this.displayDevices(devices || []);
            } catch (error) {
                this.devicesContent.innerHTML = '<div class="loading">載入失敗</div>';
            }
        }
        
        // 覆蓋播放清單獲取
        async showPlaylistModal() {
            this.playlistModal.style.display = 'flex';
            this.playlistContent.innerHTML = '<div class="loading">載入中...</div>';

            // 優先使用緩存的隊列
            const cachedQueue = this.autoUpdater.getCachedData('queue');
            if (cachedQueue && cachedQueue.length > 0) {
                this.displayPlaylist(cachedQueue);
                return;
            }

            // 如果沒有緩存，手動更新
            try {
                await this.autoUpdater.updateQueue();
                const queue = this.autoUpdater.getCachedData('queue');
                this.displayPlaylist(queue || []);
            } catch (error) {
                this.playlistContent.innerHTML = '<div class="loading">載入失敗</div>';
            }
        }
        
        // 智能喜歡狀態檢查
        async checkIfTrackIsLiked() {
            if (!this.addToPlaylistBtn || !this.currentTrack || !this.sessionId) return;
            
            // 優先使用緩存
            const likedSongs = this.autoUpdater.getCachedData('likedSongs');
            if (likedSongs && likedSongs.has(this.currentTrack.id)) {
                this.updateLikeButtonState(true);
                return;
            } else if (likedSongs) {
                this.updateLikeButtonState(false);
                return;
            }
            
            // 如果沒有緩存，手動檢查
            try {
                await this.autoUpdater.updateTrackLikeStatus(this.currentTrack.id);
            } catch (error) {
                this.log(`❌ 檢查歌曲喜歡狀態失敗: ${error.message}`);
            }
        }
        
        // 獲取自動更新系統狀態
        getAutoUpdaterStatus() {
            return this.autoUpdater.getStatus();
        }
        
        // 手動觸發完整更新
        async triggerFullUpdate() {
            this.log('🔄 手動觸發完整更新...');
            try {
                await this.autoUpdater.performFullUpdate();
                this.showSuccessMessage('✅ 完整更新完成');
            } catch (error) {
                this.showErrorMessage('更新失敗: ' + error.message);
            }
        }
        
        // 獲取緩存數據
        getCachedData(type) {
            return this.autoUpdater.getCachedData(type);
        }
        
        // 銷毀方法
        destroy() {
            if (this.autoUpdater) {
                this.autoUpdater.destroy();
            }
            super.destroy?.();
            this.log('🗑️ 超級增強播放器已銷毀');
        }
    }
    
    // 替換全局的 SpotifyLyricsPlayer 類
    window.SpotifyLyricsPlayer = SuperEnhancedSpotifyLyricsPlayer;
    
    console.log('✅ 高級自動更新系統整合完成');
    
    // 如果已經有播放器實例，重新創建
    if (window.spotifyPlayer) {
        const oldPlayer = window.spotifyPlayer;
        oldPlayer.destroy?.();
        
        // 創建新的超級增強播放器實例
        window.spotifyPlayer = new SuperEnhancedSpotifyLyricsPlayer();
        
        console.log('✅ 播放器實例已升級為超級增強版本');
    }
}

// 自動整合（如果環境允許）
if (typeof window !== 'undefined' && window.document) {
    // 等待所有依賴載入完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(integrateAdvancedUpdater, 200);
        });
    } else {
        setTimeout(integrateAdvancedUpdater, 200);
    }
}

// 導出整合函數
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { integrateAdvancedUpdater };
} else if (typeof window !== 'undefined') {
    window.integrateAdvancedUpdater = integrateAdvancedUpdater;
}

// 添加調試方法到控制台
if (typeof window !== 'undefined') {
    window.debugAutoUpdater = {
        getStatus: () => {
            if (window.spotifyPlayer && window.spotifyPlayer.getAutoUpdaterStatus) {
                return window.spotifyPlayer.getAutoUpdaterStatus();
            } else {
                console.log('❌ 超級增強播放器未初始化');
            }
        },
        triggerUpdate: () => {
            if (window.spotifyPlayer && window.spotifyPlayer.triggerFullUpdate) {
                return window.spotifyPlayer.triggerFullUpdate();
            } else {
                console.log('❌ 超級增強播放器未初始化');
            }
        },
        getCachedData: (type) => {
            if (window.spotifyPlayer && window.spotifyPlayer.getCachedData) {
                return window.spotifyPlayer.getCachedData(type);
            } else {
                console.log('❌ 超級增強播放器未初始化');
            }
        },
        showCacheInfo: () => {
            if (window.spotifyPlayer && window.spotifyPlayer.getCachedData) {
                const cacheInfo = {
                    token: !!window.spotifyPlayer.getCachedData('token'),
                    session: !!window.spotifyPlayer.getCachedData('session'),
                    userProfile: !!window.spotifyPlayer.getCachedData('userProfile'),
                    devices: window.spotifyPlayer.getCachedData('devices')?.length || 0,
                    playbackState: !!window.spotifyPlayer.getCachedData('playbackState'),
                    queue: window.spotifyPlayer.getCachedData('queue')?.length || 0,
                    likedSongs: window.spotifyPlayer.getCachedData('likedSongs')?.size || 0
                };
                console.table(cacheInfo);
                return cacheInfo;
            } else {
                console.log('❌ 超級增強播放器未初始化');
            }
        }
    };
    
    console.log('🔧 高級調試工具已載入，使用 window.debugAutoUpdater 訪問');
}