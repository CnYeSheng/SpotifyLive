class SpotifyLyricsPlayer {
    constructor() {
        this.currentTrack = null;
        this.lyrics = [];
        this.lyricsType = 'plain';
        this.currentLyricIndex = 0;
        this.autoScroll = true;
        this.fontSize = 'medium';
        this.updateInterval = null;
        this.lyricsUpdateTimeout = null;
        this.animationFrameId = null;
        this.sessionId = null;
        this.nextTrackPreviewTimeout = null;
        this.currentLyricsTrackId = null;
        this.isLoadingLyrics = false;
        this.lastExtractedImageUrl = null;
        this.lastLyricsRequest = null; // 記錄最後一次歌詞請求
        this.lyricsLoadTimeout = null; // 歌詞載入超時控制
        
        // 添加 API 速率限制控制
        this.isCheckingTrack = false;
        this.lastCheckTime = 0;
        this.baseCheckInterval = 8000; // 基礎檢查間隔8秒
        this.currentCheckInterval = 8000; // 當前檢查間隔
        this.retryCount = 0;
        this.maxRetries = 3;
        this.backoffDelay = 2000;
        
        // 速率限制狀態
        this.isRateLimited = false;
        this.retryAfterUntil = 0;
        this.rateLimitCount = 0;
        
        // 動態輪詢控制
        this.isNearTrackEnd = false;
        this.lastUserAction = 0;
        
        // 检测运行环境
        this.isVercel = window.location.hostname.includes('vercel.app');
        this.apiBase = this.isVercel ? '/api' : '';
        
        this.initializeElements();
        this.bindEvents();
        this.handleAuthCallback();
        this.checkAuthStatus();
    }

    handleAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'success') {
            this.sessionId = urlParams.get('session');
            if (this.sessionId) {
                localStorage.setItem('spotify_session_id', this.sessionId);
            }
            window.history.replaceState({}, document.title, window.location.pathname);
            this.showSuccessMessage('🎉 Spotify 連接成功！');
        } else {
            this.sessionId = localStorage.getItem('spotify_session_id');
        }
    }

    showSuccessMessage(message) {
        const successDiv = document.createElement('div');
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #1db954, #1ed760);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(29, 185, 84, 0.3);
            z-index: 1000;
            font-weight: 600;
            animation: slideIn 0.3s ease;
        `;
        successDiv.textContent = message;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => {
                if (successDiv.parentNode) {
                    successDiv.parentNode.removeChild(successDiv);
                }
            }, 300);
        }, 3000);
    }

    initializeElements() {
        // 區域元素
        this.authSection = document.getElementById('auth-section');
        this.playerSection = document.getElementById('player-section');
        this.noMusicSection = document.getElementById('no-music-section');
        
        // 音樂信息元素
        this.albumImage = document.getElementById('album-image');
        this.trackName = document.getElementById('track-name');
        this.artistName = document.getElementById('artist-name');
        this.albumName = document.getElementById('album-name');
        this.progressFill = document.getElementById('progress-fill');
        this.currentTime = document.getElementById('current-time');
        this.totalTime = document.getElementById('total-time');
        
        // 歌詞元素
        this.lyricsContent = document.getElementById('lyrics-content');
        this.autoScrollBtn = document.getElementById('auto-scroll-btn');
        this.fontSizeBtn = document.getElementById('font-size-btn');
        
        // 狀態元素
        this.spotifyStatus = document.getElementById('spotify-status');
        this.lyricsStatus = document.getElementById('lyrics-status');
        
        // 按鈕元素
        this.loginBtn = document.getElementById('login-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        
        // 播放控制元素
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.playIcon = document.getElementById('play-icon');
        this.pauseIcon = document.getElementById('pause-icon');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        this.shuffleBtn = document.getElementById('shuffle-btn');
        this.repeatBtn = document.getElementById('repeat-btn');
        this.addToPlaylistBtn = document.getElementById('add-to-playlist-btn');
        this.playlistBtn = document.getElementById('playlist-btn');
        this.devicesBtn = document.getElementById('devices-btn');
        this.volumeSlider = document.getElementById('volume-slider');
        this.volumeValue = document.getElementById('volume-value');
        this.deviceInfo = document.getElementById('device-info');
        this.deviceName = document.getElementById('device-name');
        this.nextTrackPreview = document.getElementById('next-track-preview');
        this.nextTrackName = document.getElementById('next-track-name');
        
        // 模態框元素
        this.fontSizeModal = document.getElementById('font-size-modal');
        this.closeModalBtn = document.getElementById('close-modal');
        this.fontOptions = document.querySelectorAll('.font-option');
        this.playlistModal = document.getElementById('playlist-modal');
        this.closePlaylistModalBtn = document.getElementById('close-playlist-modal');
        this.playlistContent = document.getElementById('playlist-content');
        this.devicesModal = document.getElementById('devices-modal');
        this.closeDevicesModalBtn = document.getElementById('close-devices-modal');
        this.devicesContent = document.getElementById('devices-content');
        
        // 播放狀態
        this.shuffleState = false;
        this.repeatState = 'off';
        this.smartShuffle = false;
        this.isPremium = false;
    }

    bindEvents() {
        // 登入按鈕
        this.loginBtn?.addEventListener('click', () => {
            window.location.href = '/api/auth';
        });

        // 重新檢查按鈕 - 添加防抖
        this.refreshBtn?.addEventListener('click', () => {
            this.checkCurrentTrackWithRateLimit();
        });

        // 自動滾動切換
        this.autoScrollBtn?.addEventListener('click', () => {
            this.autoScroll = !this.autoScroll;
            this.autoScrollBtn.classList.toggle('active', this.autoScroll);
        });

        // 字體大小按鈕
        this.fontSizeBtn?.addEventListener('click', () => {
            this.fontSizeModal.style.display = 'flex';
        });

        // 關閉模態框
        this.closeModalBtn?.addEventListener('click', () => {
            this.fontSizeModal.style.display = 'none';
        });

        // 字體大小選項
        this.fontOptions.forEach(option => {
            option.addEventListener('click', () => {
                this.fontSize = option.dataset.size;
                this.updateFontSize();
                this.fontSizeModal.style.display = 'none';
                
                this.fontOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
            });
        });

        // 點擊模態框背景關閉
        this.fontSizeModal?.addEventListener('click', (e) => {
            if (e.target === this.fontSizeModal) {
                this.fontSizeModal.style.display = 'none';
            }
        });

        // 播放控制事件 - 添加防抖
        this.playPauseBtn?.addEventListener('click', () => {
            this.handlePlayPause();
        });

        this.prevBtn?.addEventListener('click', () => {
            this.handlePrevious();
        });

        this.nextBtn?.addEventListener('click', () => {
            this.handleNext();
        });

        // 音量控制事件
        this.volumeSlider?.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            this.volumeValue.textContent = `${volume}%`;
            this.handleVolumeChange(volume);
        });

        this.volumeSlider?.addEventListener('change', (e) => {
            const volume = parseInt(e.target.value);
            this.setVolume(volume);
        });

        // 新功能按鈕事件
        this.shuffleBtn?.addEventListener('click', () => {
            this.toggleShuffle();
        });

        this.repeatBtn?.addEventListener('click', () => {
            this.toggleRepeat();
        });

        this.addToPlaylistBtn?.addEventListener('click', () => {
            this.addToLikedSongs();
        });

        this.playlistBtn?.addEventListener('click', () => {
            this.showPlaylistModal();
        });

        this.devicesBtn?.addEventListener('click', () => {
            this.showDevicesModal();
        });

        // 模態框關閉事件
        this.closePlaylistModalBtn?.addEventListener('click', () => {
            this.playlistModal.style.display = 'none';
        });

        this.closeDevicesModalBtn?.addEventListener('click', () => {
            this.devicesModal.style.display = 'none';
        });

        // 點擊模態框背景關閉
        this.playlistModal?.addEventListener('click', (e) => {
            if (e.target === this.playlistModal) {
                this.playlistModal.style.display = 'none';
            }
        });

        this.devicesModal?.addEventListener('click', (e) => {
            if (e.target === this.devicesModal) {
                this.devicesModal.style.display = 'none';
            }
        });
    }

    async checkAuthStatus() {
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }
            
            const response = await fetch('/api/auth-status', { headers });
            const data = await response.json();
            
            if (data.authenticated) {
                if (data.sessionId && !this.sessionId) {
                    this.sessionId = data.sessionId;
                    localStorage.setItem('spotify_session_id', this.sessionId);
                }
                this.showPlayerSection();
                this.startTracking();
            } else {
                this.showAuthSection();
                localStorage.removeItem('spotify_session_id');
                this.sessionId = null;
            }
        } catch (error) {
            console.error('檢查認證狀態失敗:', error);
            this.showAuthSection();
        }
    }

    showAuthSection() {
        this.authSection.style.display = 'flex';
        this.playerSection.style.display = 'none';
        this.noMusicSection.style.display = 'none';
        this.updateStatus('spotify', false);
    }

    showPlayerSection() {
        this.authSection.style.display = 'none';
        this.playerSection.style.display = 'grid';
        this.noMusicSection.style.display = 'none';
        this.updateStatus('spotify', true);
    }

    showNoMusicSection() {
        this.authSection.style.display = 'none';
        this.playerSection.style.display = 'none';
        this.noMusicSection.style.display = 'flex';
        this.updateStatus('spotify', true);
    }

    startTracking() {
        this.checkCurrentTrackWithRateLimit();
        // 使用動態檢查間隔
        this.updateInterval = setInterval(() => {
            this.checkCurrentTrackWithRateLimit();
        }, this.currentCheckInterval);
    }
    
    // 重新啟動追蹤（用於動態調整間隔）
    restartTracking() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            this.checkCurrentTrackWithRateLimit();
        }, this.currentCheckInterval);
    }
    
    // 動態調整輪詢間隔
    adjustPollingInterval() {
        let newInterval = this.baseCheckInterval;
        
        // 如果接近歌曲結尾，加速輪詢
        if (this.isNearTrackEnd) {
            newInterval = 2000; // 2秒
        }
        // 如果最近有用戶操作，短暫加速
        else if (Date.now() - this.lastUserAction < 10000) {
            newInterval = 3000; // 3秒
        }
        // 如果被限速過，延長間隔
        else if (this.rateLimitCount > 0) {
            newInterval = Math.min(this.baseCheckInterval * (1 + this.rateLimitCount * 0.5), 15000);
        }
        
        if (newInterval !== this.currentCheckInterval) {
            this.currentCheckInterval = newInterval;
            console.log(`🔄 調整輪詢間隔為 ${newInterval / 1000} 秒`);
            this.restartTracking();
        }
    }

    stopTracking() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.lyricsUpdateTimeout) {
            clearTimeout(this.lyricsUpdateTimeout);
            this.lyricsUpdateTimeout = null;
        }
        if (this.nextTrackPreviewTimeout) {
            clearTimeout(this.nextTrackPreviewTimeout);
            this.nextTrackPreviewTimeout = null;
        }
        if (this.lyricsLoadTimeout) {
            clearTimeout(this.lyricsLoadTimeout);
            this.lyricsLoadTimeout = null;
        }
    }

    // 添加速率限制檢查
    checkCurrentTrackWithRateLimit() {
        const now = Date.now();
        
        // 檢查是否在速率限制期間
        if (this.isRateLimited && now < this.retryAfterUntil) {
            const waitSec = Math.ceil((this.retryAfterUntil - now) / 1000);
            console.log(`⏸️ 速率限制中，還需等待 ${waitSec} 秒`);
            return;
        }
        
        // 如果速率限制已過期，重置狀態
        if (this.isRateLimited && now >= this.retryAfterUntil) {
            this.isRateLimited = false;
            console.log('✅ 速率限制已解除');
        }
        
        // 如果正在檢查中，跳過
        if (this.isCheckingTrack) {
            console.log('⏳ 正在檢查中，跳過此次請求');
            return;
        }
        
        // 檢查最小間隔
        if (now - this.lastCheckTime < this.currentCheckInterval) {
            console.log('⏳ 間隔時間不足，跳過此次請求');
            return;
        }
        
        this.lastCheckTime = now;
        this.checkCurrentTrack();
    }

    async checkCurrentTrack() {
        // 防止重複請求
        if (this.isCheckingTrack) {
            return;
        }
        
        this.isCheckingTrack = true;
        
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }
            
            const response = await fetch(`${this.apiBase}/api/current-track`, { headers });
            
            if (response.status === 401) {
                this.showAuthSection();
                this.stopTracking();
                localStorage.removeItem('spotify_session_id');
                this.sessionId = null;
                return;
            }

            // 處理速率限制
            if (response.status === 429) {
                const data = await response.json().catch(() => ({}));
                const retryAfter = data.retryAfter || 5000;
                const now = Date.now();
                
                // 設置速率限制狀態
                this.isRateLimited = true;
                this.retryAfterUntil = now + retryAfter;
                this.rateLimitCount++;
                
                console.warn(`🚫 API 速率限制，${retryAfter / 1000} 秒後重試 (第${this.rateLimitCount}次)`);
                
                // 自動解除速率限制
                setTimeout(() => {
                    this.isRateLimited = false;
                    console.log('✅ 速率限制自動解除');
                    // 調整輪詢間隔
                    this.adjustPollingInterval();
                }, retryAfter);
                
                this.showRateLimitMessage(retryAfter);
                return;
            }

            if (!response.ok) {
                console.error(`API 錯誤: ${response.status} ${response.statusText}`);
                if (response.status >= 500) {
                    console.log('服务器错误，稍后重试...');
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
            
            // 只在新歌曲時更新這些內容
            if (isNewTrack) {
                this.updateTrackInfo();
                // 重置歌詞狀態
                this.lyrics = [];
                this.currentLyricsTrackId = null;
                this.isLoadingLyrics = false;
                
                // 使用安全的歌詞載入方法
                this.safeLyricsLoad();
                console.log('🎵 新歌曲，更新所有信息');
            }
            
            // 更新下一首預覽（使用一次性獲取的數據）
            this.updateNextTrackPreview();
            
            // 每次都需要更新的內容
            this.updatePlayerControls();
            this.updateProgress();
            this.showPlayerSection();
            this.updateStatus('spotify', true);
            
            // 檢查是否接近歌曲結尾
            const remainingTime = this.currentTrack.duration - this.currentTrack.progress;
            const wasNearEnd = this.isNearTrackEnd;
            this.isNearTrackEnd = remainingTime <= 10000; // 最後10秒
            
            // 如果狀態改變，調整輪詢間隔
            if (wasNearEnd !== this.isNearTrackEnd) {
                this.adjustPollingInterval();
            }
            
            // 重置重試計數器（成功請求）
            this.retryCount = 0;
            if (this.rateLimitCount > 0) {
                this.rateLimitCount = Math.max(0, this.rateLimitCount - 1);
            }

        } catch (error) {
            console.error('獲取當前播放失敗:', error);
            this.updateStatus('spotify', false);
            this.scheduleRetry(this.minCheckInterval);
        } finally {
            this.isCheckingTrack = false;
        }
    }

    // 記錄用戶操作（用於動態調整輪詢）
    recordUserAction() {
        this.lastUserAction = Date.now();
        console.log('👆 用戶操作，短暫加速輪詢');
        this.adjustPollingInterval();
    }
    
    // 顯示速率限制消息
    showRateLimitMessage(delay) {
        const message = `⏳ API 請求過於頻繁，${Math.ceil(delay / 1000)} 秒後自動重試`;
        this.showErrorMessage(message);
    }

    // 排程重試
    scheduleRetry(delay) {
        setTimeout(() => {
            if (!this.isCheckingTrack) {
                this.checkCurrentTrack();
            }
        }, delay);
    }

    updateTrackInfo() {
        if (!this.currentTrack) return;

        this.albumImage.src = this.currentTrack.image || '';
        this.albumImage.alt = `${this.currentTrack.album} 專輯封面`;
        this.trackName.textContent = this.currentTrack.name;
        this.artistName.textContent = this.currentTrack.artist;
        this.albumName.textContent = this.currentTrack.album;
        this.totalTime.textContent = this.formatTime(this.currentTrack.duration);
        
        // 提取專輯封面顏色並更新背景
        if (this.currentTrack.image && this.currentTrack.image !== this.lastExtractedImageUrl) {
            this.lastExtractedImageUrl = this.currentTrack.image;
            this.extractColorsAndUpdateBackground(this.currentTrack.image);
        }
        
        // 更新設備信息
        if (this.currentTrack.device && this.deviceInfo) {
            this.deviceName.textContent = `${this.currentTrack.device.name} (${this.currentTrack.device.type})`;
            this.deviceInfo.style.display = 'block';
            
            if (this.currentTrack.device.volume !== null && this.currentTrack.device.volume !== undefined && this.volumeSlider) {
                this.volumeSlider.value = this.currentTrack.device.volume;
                this.volumeValue.textContent = `${this.currentTrack.device.volume}%`;
            }
        } else if (this.deviceInfo) {
            this.deviceInfo.style.display = 'none';
        }

        // 更新播放狀態
        if (this.currentTrack.shuffle_state !== undefined) {
            this.shuffleState = this.currentTrack.shuffle_state;
            this.updateShuffleButton();
        }
        
        if (this.currentTrack.repeat_state !== undefined) {
            this.repeatState = this.currentTrack.repeat_state;
            this.updateRepeatButton();
        }

        if (this.currentTrack.is_premium !== undefined) {
            this.isPremium = this.currentTrack.is_premium;
            this.updatePremiumButtons();
        }

        if (this.currentTrack.smart_shuffle !== undefined) {
            this.smartShuffle = this.currentTrack.smart_shuffle;
            this.updateShuffleButton();
        }
    }

    updateProgress() {
        if (!this.currentTrack) return;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        const update = () => {
            if (!this.currentTrack) {
                this.animationFrameId = null;
                return;
            }

            let elapsedTime;
            if (this.currentTrack.isPlaying) {
                elapsedTime = (Date.now() - this.currentTrack.lastUpdated) + this.currentTrack.progress;
            } else {
                elapsedTime = this.currentTrack.progress;
            }
            
            const progress = (elapsedTime / this.currentTrack.duration) * 100;
            this.progressFill.style.width = `${Math.min(100, progress)}%`;
            this.currentTime.textContent = this.formatTime(elapsedTime);

            this.updateLyricsHighlight(elapsedTime);

            const remainingTime = this.currentTrack.duration - elapsedTime;
            if (remainingTime <= 5000 && remainingTime > 0 && this.currentTrack.isPlaying) {
                this.showNextTrackPreview();
            }

            if (this.currentTrack.isPlaying && elapsedTime < this.currentTrack.duration) {
                this.animationFrameId = requestAnimationFrame(update);
            } else {
                this.animationFrameId = null;
            }
        };

        update();
    }

    async loadLyrics() {
        if (!this.currentTrack) {
            console.log('❌ 沒有當前歌曲，跳過歌詞載入');
            return;
        }

        const trackKey = `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}`;
        console.log(`🎤 請求歌詞: ${this.currentTrack.artist} - ${this.currentTrack.name}`);
        
        // 檢查是否已有該歌曲的歌詞
        if (this.lyrics && this.lyrics.length > 0 && this.currentLyricsTrackId === this.currentTrack.id) {
            console.log('✅ 歌詞已存在，跳過載入');
            return;
        }

        // 防止重複請求 - 使用更嚴格的檢查
        if (this.isLoadingLyrics) {
            console.log('⏳ 歌詞正在載入中，跳過重複請求');
            return;
        }
        
        // 檢查是否最近剛請求過同一首歌 (延長時間到15秒避免重複請求)
        if (this.lastLyricsRequest && 
            this.lastLyricsRequest.trackKey === trackKey && 
            Date.now() - this.lastLyricsRequest.time < 15000) {
            console.log('⏳ 最近剛請求過此歌曲，跳過重複請求');
            return;
        }
        
        // 設置載入狀態和請求記錄
        this.isLoadingLyrics = true;
        this.lastLyricsRequest = {
            trackKey: trackKey,
            time: Date.now()
        };
        
        // 設置載入超時保護 (延長到40秒以適應較慢網絡)
        const loadingTimeout = setTimeout(() => {
            if (this.isLoadingLyrics) {
                console.log('⚠️ 歌詞載入超時，重置狀態');
                this.isLoadingLyrics = false;
                // 清除可能存在的載入超時ID
                if (this.lyricsLoadTimeout) {
                    clearTimeout(this.lyricsLoadTimeout);
                    this.lyricsLoadTimeout = null;
                }
            }
        }, 40000);

        this.updateStatus('lyrics', null);
        this.showLyricsPlaceholder('🎵 正在載入歌詞...');

        try {
            // 由於 CORS 限制，直接使用本地代理
            const proxyUrl = `${this.apiBase}/api/lyrics/${encodeURIComponent(this.currentTrack.artist)}/${encodeURIComponent(this.currentTrack.name)}`;
            console.log(`📡 通過代理請求歌詞: ${proxyUrl}`);
            
            const response = await fetch(proxyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`API 響應錯誤: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('歌詞 API 回應:', data);

            if (data.success && data.lyrics && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
                const validLyrics = data.lyrics.filter(line => {
                    const text = line.text || line;
                    return text && text.trim() !== '' && this.isValidText(text);
                });

                if (validLyrics.length > 0) {
                    // 確保這是當前歌曲的歌詞
                    if (this.currentTrack && this.currentTrack.id) {
                        this.lyrics = validLyrics;
                        this.lyricsType = data.type || 'plain';
                        this.currentLyricsTrackId = this.currentTrack.id;
                        this.displayLyrics();
                        this.updateStatus('lyrics', true);
                        console.log(`✅ 歌詞載入成功: ${validLyrics.length} 行 (${this.lyricsType}) 來源: ${data.source}`);
                    } else {
                        console.log('⚠️ 歌曲已切換，忽略此歌詞響應');
                    }
                } else {
                    console.log(`❌ 歌詞內容無效或為亂碼`);
                    this.showLyricsError('歌詞內容格式錯誤');
                }
            } else {
                const errorMsg = data.error || '找不到歌詞';
                console.log(`❌ 歌詞載入失敗: ${errorMsg}`);
                this.showLyricsError(errorMsg);
            }
        } catch (error) {
            console.error('載入歌詞失敗:', error);
            this.showLyricsError('載入歌詞失敗: ' + error.message);
        } finally {
            clearTimeout(loadingTimeout);
            this.isLoadingLyrics = false;
            // 確保清除載入超時
            if (this.lyricsLoadTimeout) {
                clearTimeout(this.lyricsLoadTimeout);
                this.lyricsLoadTimeout = null;
            }
        }
    }

    isValidText(text) {
        if (!text || typeof text !== 'string') return false;
        
        const garbledChars = /[\uFFFD]/g;
        const garbledCount = (text.match(garbledChars) || []).length;
        
        if (garbledCount > text.length * 0.3) {
            return false;
        }
        
        const normalChars = /[\u4e00-\u9fff\u3400-\u4dbf\w\s\-,.!?'"()[\]]/g;
        const normalCount = (text.match(normalChars) || []).length;
        
        return normalCount >= text.length * 0.5;
    }

    showLyricsPlaceholder(text) {
        this.lyricsContent.innerHTML = `
            <div class="lyrics-placeholder">
                <p style="white-space: pre-line;">${text}</p>
            </div>
        `;
    }

    showLyricsError(errorMsg) {
        this.showLyricsPlaceholder(`${errorMsg}`);
        this.updateStatus('lyrics', false);
    }

    displayLyrics() {
        if (!this.lyrics || this.lyrics.length === 0) return;

        const lyricsHTML = this.lyrics.map((line, index) => {
            let text = this.lyricsType === 'synced' ? line.text : (line.text || line);
            if (typeof convertToTraditional === 'function') {
                text = convertToTraditional(text);
            }
            const timeAttr = this.lyricsType === 'synced' && line.time ? `data-time="${line.time}"` : '';
            return `<div class="lyrics-line" data-index="${index}" ${timeAttr}>${this.escapeHtml(text)}</div>`;
        }).join('');

        this.lyricsContent.innerHTML = lyricsHTML;

        if (this.lyricsType === 'synced') {
            const indicator = document.createElement('div');
            indicator.className = 'sync-indicator';
            indicator.innerHTML = '🎵 同步歌詞';
            this.lyricsContent.insertBefore(indicator, this.lyricsContent.firstChild);
        }
    }

    updateLyricsHighlight(currentTime) {
        if (!this.lyrics || this.lyrics.length === 0) return;

        let targetIndex = -1;

        if (currentTime !== undefined) {
            if (this.lyricsType === 'synced') {
                // 增強的同步歌詞邏輯
                let bestMatch = -1;
                let minDistance = Infinity;
                
                for (let i = 0; i < this.lyrics.length; i++) {
                    const line = this.lyrics[i];
                    if (!line.time) continue; // 跳過沒有時間戳的行
                    
                    const nextLine = this.lyrics[i + 1];
                    const tolerance = 300; // 增加容錯範圍到300ms
                    
                    // 檢查當前時間是否在這一行的時間範圍內
                    if (line.time <= currentTime + tolerance) {
                        if (!nextLine || !nextLine.time || nextLine.time > currentTime + tolerance) {
                            targetIndex = i;
                            break;
                        } else {
                            // 如果在兩行之間，選擇距離更近的
                            const distanceToCurrent = Math.abs(currentTime - line.time);
                            const distanceToNext = Math.abs(currentTime - nextLine.time);
                            
                            if (distanceToCurrent < minDistance) {
                                minDistance = distanceToCurrent;
                                bestMatch = i;
                            }
                        }
                    }
                }
                
                // 如果沒有找到精確匹配，使用最佳匹配
                if (targetIndex === -1 && bestMatch !== -1) {
                    targetIndex = bestMatch;
                }
                
                // 如果還是沒有找到，使用最後一個已過時間的歌詞行
                if (targetIndex === -1) {
                    for (let i = this.lyrics.length - 1; i >= 0; i--) {
                        const line = this.lyrics[i];
                        if (line.time && line.time <= currentTime) {
                            targetIndex = i;
                            break;
                        }
                    }
                }
            } else {
                // 普通歌詞的時間估算邏輯
                if (this.currentTrack && this.currentTrack.duration > 0) {
                    const timeOffset = 500;
                    const adjustedProgress = Math.max(0, (currentTime - timeOffset) / this.currentTrack.duration);
                    targetIndex = Math.floor(adjustedProgress * this.lyrics.length);
                    targetIndex = Math.max(0, Math.min(targetIndex, this.lyrics.length - 1));
                }
            }
            
            if (this.autoScroll) {
                this.currentLyricIndex = targetIndex;
            }
        }

        // 移除所有高亮
        const lyricsLines = this.lyricsContent.querySelectorAll('.lyrics-line');
        lyricsLines.forEach(line => {
            line.classList.remove('current', 'upcoming', 'past');
        });

        // 只添加當前行高亮，不添加upcoming和past類
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length) {
            const currentLine = this.lyricsContent.querySelector(`[data-index="${this.currentLyricIndex}"]`);
            if (currentLine) {
                currentLine.classList.add('current');
                
                if (this.autoScroll) {
                    currentLine.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                        inline: 'nearest'
                    });
                }
            }
        }
    }

    updateFontSize() {
        this.lyricsContent.className = `lyrics-content font-${this.fontSize}`;
    }

    updateStatus(type, status) {
        const statusDot = type === 'spotify' ? this.spotifyStatus : this.lyricsStatus;
        if (!statusDot) return;

        statusDot.classList.remove('connected', 'error');
        
        if (status === true) {
            statusDot.classList.add('connected');
        } else if (status === false) {
            statusDot.classList.add('error');
        }
    }

    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 前端 LRC 格式解析函數
    parseLrcFormat(lrcText) {
        if (!lrcText || typeof lrcText !== 'string') {
            return { isLrc: false, lyrics: [] };
        }
        
        const lines = lrcText.split('\n');
        const lyrics = [];
        let hasTimeStamps = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 檢查 LRC 時間戳格式 [mm:ss.xx] 或 [mm:ss]
            const timeMatch = trimmedLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
            
            if (timeMatch) {
                hasTimeStamps = true;
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
                const text = timeMatch[4].trim();
                
                const timeMs = (minutes * 60 + seconds) * 1000 + milliseconds;
                
                if (text) {
                    lyrics.push({
                        time: timeMs,
                        text: text
                    });
                }
            } else {
                // 非時間戳行，可能是純文本歌詞或元數據
                if (!trimmedLine.startsWith('[') || !trimmedLine.includes(']')) {
                    lyrics.push({
                        text: trimmedLine
                    });
                }
            }
        }
        
        // 如果有時間戳，按時間排序
        if (hasTimeStamps) {
            lyrics.sort((a, b) => (a.time || 0) - (b.time || 0));
        }
        
        return {
            isLrc: hasTimeStamps,
            lyrics: lyrics
        };
    }

    // 播放控制方法（添加防抖機制）
    updatePlayerControls() {
        if (!this.currentTrack) return;

        if (this.currentTrack.isPlaying) {
            this.playIcon.style.display = 'none';
            this.pauseIcon.style.display = 'block';
        } else {
            this.playIcon.style.display = 'block';
            this.pauseIcon.style.display = 'none';
        }
    }

    // 添加防抖處理的控制方法
    handlePlayPause() {
        if (!this.currentTrack || !this.sessionId) return;
        
        // 防抖處理
        if (this.playPauseDebounce) {
            clearTimeout(this.playPauseDebounce);
        }
        
        this.playPauseDebounce = setTimeout(() => {
            this.sendPlayPauseRequest();
        }, 200);
    }

    async sendPlayPauseRequest() {
        this.recordUserAction();
        try {
            const response = await fetch(`${this.apiBase}/api/playback/play-pause`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('播放/暫停成功');
                // 延遲更新以避免過多 API 調用
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                console.error('播放/暫停失敗:', data.error);
            }
        } catch (error) {
            console.error('播放/暫停請求失敗:', error);
        }
    }

    handlePrevious() {
        if (!this.currentTrack || !this.sessionId) return;
        
        if (this.previousDebounce) {
            clearTimeout(this.previousDebounce);
        }
        
        this.previousDebounce = setTimeout(() => {
            this.sendPreviousRequest();
        }, 200);
    }

    async sendPreviousRequest() {
        this.recordUserAction();
        try {
            const response = await fetch(`${this.apiBase}/api/playback/previous`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('上一首成功');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                console.error('上一首失敗:', data.error);
            }
        } catch (error) {
            console.error('上一首請求失敗:', error);
        }
    }

    handleNext() {
        if (!this.currentTrack || !this.sessionId) return;
        
        if (this.nextDebounce) {
            clearTimeout(this.nextDebounce);
        }
        
        this.nextDebounce = setTimeout(() => {
            this.sendNextRequest();
        }, 200);
    }

    async sendNextRequest() {
        this.recordUserAction();
        try {
            const response = await fetch(`${this.apiBase}/api/playback/next`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('下一首成功');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                console.error('下一首失敗:', data.error);
            }
        } catch (error) {
            console.error('下一首請求失敗:', error);
        }
    }

    handleVolumeChange(volume) {
        if (!this.currentTrack || !this.sessionId) return;

        // 音量變化防抖
        if (this.volumeDebounce) {
            clearTimeout(this.volumeDebounce);
        }
        
        this.volumeDebounce = setTimeout(() => {
            this.sendVolumeRequest(volume);
        }, 300);
    }

    async sendVolumeRequest(volume) {
        try {
            const response = await fetch(`${this.apiBase}/api/playback/volume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ volume })
            });
            
            const data = await response.json();
            if (data.success) {
                console.log(`音量設置為 ${volume}%`);
            } else {
                console.error('音量設置失敗:', data.error);
            }
        } catch (error) {
            console.error('音量設置請求失敗:', error);
        }
    }

    setVolume(volume) {
        if (!this.currentTrack || !this.sessionId) return;

        if (this.setVolumeDebounce) {
            clearTimeout(this.setVolumeDebounce);
        }
        
        this.setVolumeDebounce = setTimeout(() => {
            this.sendSetVolumeRequest(volume);
        }, 500);
    }

    async sendSetVolumeRequest(volume) {
        try {
            const response = await fetch(`${this.apiBase}/api/playback/volume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ volume, set: true })
            });
            
            const data = await response.json();
            if (data.success) {
                console.log(`音量設置為 ${volume}%`);
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                console.error('音量設置失敗:', data.error);
            }
        } catch (error) {
            console.error('音量設置請求失敗:', error);
        }
    }

    toggleShuffle() {
        if (!this.currentTrack || !this.sessionId) return;

        if (this.shuffleDebounce) {
            clearTimeout(this.shuffleDebounce);
        }
        
        this.shuffleDebounce = setTimeout(() => {
            this.sendShuffleRequest();
        }, 200);
    }

    async sendShuffleRequest() {
        try {
            const response = await fetch(`${this.apiBase}/api/playback/shuffle`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('隨機播放切換成功');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                console.error('隨機播放切換失敗:', data.error);
            }
        } catch (error) {
            console.error('隨機播放切換請求失敗:', error);
        }
    }

    toggleRepeat() {
        if (!this.currentTrack || !this.sessionId) return;

        if (this.repeatDebounce) {
            clearTimeout(this.repeatDebounce);
        }
        
        this.repeatDebounce = setTimeout(() => {
            this.sendRepeatRequest();
        }, 200);
    }

    async sendRepeatRequest() {
        try {
            const response = await fetch(`${this.apiBase}/api/playback/repeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('重複播放切換成功');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                console.error('重複播放切換失敗:', data.error);
            }
        } catch (error) {
            console.error('重複播放切換請求失敗:', error);
        }
    }

    addToLikedSongs() {
        if (!this.currentTrack || !this.sessionId) return;

        if (this.likedSongsDebounce) {
            clearTimeout(this.likedSongsDebounce);
        }
        
        this.likedSongsDebounce = setTimeout(() => {
            this.sendAddToLikedRequest();
        }, 200);
    }

    async sendAddToLikedRequest() {
        try {
            const response = await fetch(`${this.apiBase}/api/library/add`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ trackId: this.currentTrack.id })
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('已添加到喜歡的歌曲');
                this.showSuccessMessage('❤️ 已添加到喜歡的歌曲');
            } else {
                console.error('添加到喜歡的歌曲失敗:', data.error);
                this.showErrorMessage('添加失敗: ' + (data.error || '未知錯誤'));
            }
        } catch (error) {
            console.error('添加到喜歡的歌曲請求失敗:', error);
            this.showErrorMessage('網絡錯誤，請重試');
        }
    }

    // 更新下一首預覽（使用已獲取的數據）
    updateNextTrackPreview() {
        if (!this.nextTrackName) return;
        
        if (this.currentTrack?.nextTrack) {
            this.nextTrackName.textContent = `${this.currentTrack.nextTrack.artist} - ${this.currentTrack.nextTrack.name}`;
        } else {
            this.nextTrackName.textContent = '無下一首';
        }
    }
    
    // 保留原方法作為備用（如果需要單獨獲取）
    async loadNextTrackPreview() {
        // 如果已經有數據，直接使用
        if (this.currentTrack?.nextTrack) {
            this.updateNextTrackPreview();
            return;
        }
        
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch(`${this.apiBase}/api/player/queue`, { headers });
            if (response.ok) {
                const data = await response.json();
                if (data.nextTrack) {
                    this.nextTrackName.textContent = `${data.nextTrack.artist} - ${data.nextTrack.name}`;
                } else {
                    this.nextTrackName.textContent = '無下一首';
                }
            } else {
                this.nextTrackName.textContent = '無下一首';
            }
        } catch (error) {
            console.error('載入下一首預覽失敗:', error);
            this.nextTrackName.textContent = '無下一首';
        }
    }
    
    // 安全的歌詞載入方法 - 防止重複調用
    safeLyricsLoad() {
        // 清除之前的載入請求
        if (this.lyricsLoadTimeout) {
            clearTimeout(this.lyricsLoadTimeout);
            console.log('🔄 清除之前的歌詞載入請求');
        }
        
        // 如果已經在載入中，直接返回
        if (this.isLoadingLyrics) {
            console.log('⏳ 歌詞載入中，忽略新的載入請求');
            return;
        }
        
        // 檢查是否最近剛請求過 (延長時間到15秒避免重複請求)
        const trackKey = this.currentTrack ? `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}` : null;
        if (this.lastLyricsRequest && 
            this.lastLyricsRequest.trackKey === trackKey && 
            Date.now() - this.lastLyricsRequest.time < 15000) {
            console.log('⏳ 最近剛請求過此歌曲，跳過重複請求');
            return;
        }
        
        this.lyricsLoadTimeout = setTimeout(() => {
            if (this.currentTrack && !this.isLoadingLyrics) {
                console.log('⏰ 執行延遲的歌詞載入');
                this.loadLyrics();
            } else {
                console.log('⏸️ 跳過歌詞載入：歌曲已切換或正在載入中');
            }
            this.lyricsLoadTimeout = null;
        }, 2000); // 設置為2秒延遲，給Spotify API一點時間穩定
    }

    showNextTrackPreview() {
        if (this.nextTrackPreview && this.nextTrackName.textContent !== '無下一首') {
            this.nextTrackPreview.style.display = 'block';
            
            if (this.nextTrackPreviewTimeout) {
                clearTimeout(this.nextTrackPreviewTimeout);
            }
            
            this.nextTrackPreviewTimeout = setTimeout(() => {
                this.nextTrackPreview.style.display = 'none';
            }, 5000);
        }
    }

    extractColorsAndUpdateBackground(imageUrl) {
        this.fetchImageThroughProxy(imageUrl)
            .then(colors => {
                if (colors && colors.length > 0) {
                    this.updateDynamicBackground(colors);
                    console.log('✅ 成功提取專輯封面顏色:', colors);
                } else {
                    this.useDefaultBackground();
                }
            })
            .catch(error => {
                console.error('❌ 顏色提取失敗:', error);
                this.useDefaultBackground();
            });
    }

    async fetchImageThroughProxy(imageUrl) {
        try {
            const response = await fetch(`${this.apiBase}/api/extract-colors`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ imageUrl })
            });

            if (response.ok) {
                const data = await response.json();
                return data.colors;
            } else {
                throw new Error('代理請求失敗');
            }
        } catch (error) {
            console.error('代理顏色提取失敗:', error);
            return this.extractColorsDirectly(imageUrl);
        }
    }

    extractColorsDirectly(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    canvas.width = 100;
                    canvas.height = 100;
                    ctx.drawImage(img, 0, 0, 100, 100);
                    
                    const imageData = ctx.getImageData(0, 0, 100, 100);
                    const colors = this.extractDominantColors(imageData.data);
                    
                    resolve(colors);
                } catch (error) {
                    reject(error);
                }
            };
            
            img.onerror = () => {
                reject(new Error('圖片載入失敗'));
            };
            
            img.crossOrigin = 'anonymous';
            img.src = imageUrl;
        });
    }

    extractDominantColors(imageData) {
        const colorMap = new Map();
        
        for (let i = 0; i < imageData.length; i += 16) {
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];
            const a = imageData[i + 3];
            
            if (a < 128) continue;
            
            const quantizedR = Math.floor(r / 32) * 32;
            const quantizedG = Math.floor(g / 32) * 32;
            const quantizedB = Math.floor(b / 32) * 32;
            
            const colorKey = `${quantizedR},${quantizedG},${quantizedB}`;
            colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
        }
        
        const sortedColors = Array.from(colorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([color]) => {
                const [r, g, b] = color.split(',').map(Number);
                return { r, g, b };
            });
        
        while (sortedColors.length < 3) {
            sortedColors.push({ r: 102, g: 126, b: 234 });
        }
        
        return sortedColors;
    }

    updateDynamicBackground(colors) {
        const body = document.body;
        
        if (this.currentTrack && this.currentTrack.image) {
            let bgContainer = document.getElementById('album-bg-container');
            if (!bgContainer) {
                bgContainer = document.createElement('div');
                bgContainer.id = 'album-bg-container';
                bgContainer.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: -1;
                    transition: opacity 1s ease;
                `;
                document.body.appendChild(bgContainer);
            }
            
            bgContainer.style.backgroundImage = `url(${this.currentTrack.image})`;
            bgContainer.style.backgroundSize = 'cover';
            bgContainer.style.backgroundPosition = 'center';
            bgContainer.style.backgroundRepeat = 'no-repeat';
            bgContainer.style.filter = 'blur(30px) brightness(0.3)';
            bgContainer.style.transform = 'scale(1.1)';
            bgContainer.style.opacity = '1';
            
            body.style.backgroundImage = 'none';
            body.style.backgroundColor = '#000000';
        } else {
            const bgContainer = document.getElementById('album-bg-container');
            if (bgContainer) {
                bgContainer.style.opacity = '0';
                setTimeout(() => {
                    if (bgContainer.parentNode) {
                        bgContainer.parentNode.removeChild(bgContainer);
                    }
                }, 1000);
            }
            
            const color1 = `rgb(${colors[0].r}, ${colors[0].g}, ${colors[0].b})`;
            const color2 = `rgb(${colors[1].r}, ${colors[1].g}, ${colors[1].b})`;
            const color3 = `rgb(${colors[2].r}, ${colors[2].g}, ${colors[2].b})`;
            
            const backgroundStyle = `
                radial-gradient(circle at 20% 80%, ${color1} 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, ${color2} 0%, transparent 50%),
                radial-gradient(circle at 40% 40%, ${color3} 0%, transparent 50%)
            `;
            
            body.style.backgroundImage = backgroundStyle;
            body.style.backgroundSize = '120% 120%';
            body.style.backgroundPosition = 'center';
            body.style.backgroundAttachment = 'fixed';
            body.style.backgroundColor = '#000000';
        }
        
        const color1 = `rgb(${colors[0].r}, ${colors[0].g}, ${colors[0].b})`;
        const color2 = `rgb(${colors[1].r}, ${colors[1].g}, ${colors[1].b})`;
        const color3 = `rgb(${colors[2].r}, ${colors[2].g}, ${colors[2].b})`;
        
        document.documentElement.style.setProperty('--album-color-1', color1);
        document.documentElement.style.setProperty('--album-color-2', color2);
        document.documentElement.style.setProperty('--album-color-3', color3);
        
        this.animateBackgroundPosition();
    }

    useDefaultBackground() {
        const defaultColors = [
            'rgb(102, 126, 234)',
            'rgb(118, 75, 162)', 
            'rgb(240, 147, 251)'
        ];
        
        const backgroundStyle = `
            radial-gradient(circle at 20% 80%, ${defaultColors[0]} 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, ${defaultColors[1]} 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, ${defaultColors[2]} 0%, transparent 50%)
        `;
        
        document.body.style.backgroundImage = backgroundStyle;
    }

    animateBackgroundPosition() {
        let angle = 0;
        
        const animate = () => {
            angle += 0.5;
            const x1 = 20 + Math.sin(angle * 0.01) * 10;
            const y1 = 80 + Math.cos(angle * 0.01) * 10;
            const x2 = 80 + Math.sin(angle * 0.015) * 15;
            const y2 = 20 + Math.cos(angle * 0.015) * 15;
            const x3 = 40 + Math.sin(angle * 0.008) * 8;
            const y3 = 40 + Math.cos(angle * 0.008) * 8;
            
            document.documentElement.style.setProperty('--bg-x1', `${x1}%`);
            document.documentElement.style.setProperty('--bg-y1', `${y1}%`);
            document.documentElement.style.setProperty('--bg-x2', `${x2}%`);
            document.documentElement.style.setProperty('--bg-y2', `${y2}%`);
            document.documentElement.style.setProperty('--bg-x3', `${x3}%`);
            document.documentElement.style.setProperty('--bg-y3', `${y3}%`);
            
            if (this.currentTrack && this.currentTrack.isPlaying) {
                requestAnimationFrame(animate);
            }
        };
        
        if (this.currentTrack && this.currentTrack.isPlaying) {
            animate();
        }
    }

    async showPlaylistModal() {
        this.playlistModal.style.display = 'flex';
        this.playlistContent.innerHTML = '<div class="loading">載入中...</div>';

        // 優先使用已獲取的隊列數據
        if (this.currentTrack?.queue && this.currentTrack.queue.length > 0) {
            this.displayPlaylist(this.currentTrack.queue);
            return;
        }

        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch(`${this.apiBase}/api/player/queue`, { headers });
            if (response.ok) {
                const data = await response.json();
                this.displayPlaylist(data.queue || []);
            } else {
                this.playlistContent.innerHTML = '<div class="loading">無法載入播放清單</div>';
            }
        } catch (error) {
            console.error('載入播放清單失敗:', error);
            this.playlistContent.innerHTML = '<div class="loading">載入失敗</div>';
        }
    }

    displayPlaylist(tracks) {
        if (!tracks || tracks.length === 0) {
            this.playlistContent.innerHTML = '<div class="loading">播放清單為空</div>';
            return;
        }

        const playlistHTML = tracks.map((track, index) => `
            <div class="playlist-item ${track.id === this.currentTrack?.id ? 'current' : ''}" data-track-id="${track.id}">
                <img src="${track.image || ''}" alt="${track.name}" onerror="this.style.display='none'">
                <div class="playlist-item-info">
                    <div class="playlist-item-title">${this.escapeHtml(track.name)}</div>
                    <div class="playlist-item-artist">${this.escapeHtml(track.artist)}</div>
                </div>
            </div>
        `).join('');

        this.playlistContent.innerHTML = playlistHTML;

        this.playlistContent.querySelectorAll('.playlist-item').forEach(item => {
            item.addEventListener('click', () => {
                const trackId = item.dataset.trackId;
                this.playTrack(trackId);
            });
        });
    }

    async showDevicesModal() {
        this.devicesModal.style.display = 'flex';
        this.devicesContent.innerHTML = '<div class="loading">載入中...</div>';

        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch(`${this.apiBase}/api/devices`, { headers });
            if (response.ok) {
                const data = await response.json();
                this.displayDevices(data.devices || []);
            } else {
                this.devicesContent.innerHTML = '<div class="loading">無法載入設備</div>';
            }
        } catch (error) {
            console.error('載入設備失敗:', error);
            this.devicesContent.innerHTML = '<div class="loading">載入失敗</div>';
        }
    }

    displayDevices(devices) {
        if (!devices || devices.length === 0) {
            this.devicesContent.innerHTML = '<div class="loading">沒有可用設備</div>';
            return;
        }

        const devicesHTML = devices.map(device => `
            <div class="device-item ${device.is_active ? 'active' : ''}" data-device-id="${device.id}">
                <div class="device-icon">
                    ${this.getDeviceIcon(device.type)}
                </div>
                <div class="device-info-modal">
                    <div class="device-name">${this.escapeHtml(device.name)}</div>
                    <div class="device-type">${this.escapeHtml(device.type)} ${device.volume_percent !== null ? `• ${device.volume_percent}%` : ''}</div>
                </div>
            </div>
        `).join('');

        this.devicesContent.innerHTML = devicesHTML;

        this.devicesContent.querySelectorAll('.device-item').forEach(item => {
            item.addEventListener('click', () => {
                const deviceId = item.dataset.deviceId;
                this.transferPlayback(deviceId);
            });
        });
    }

    getDeviceIcon(type) {
        const icons = {
            'Computer': '💻',
            'Smartphone': '📱',
            'Speaker': '🔊',
            'TV': '📺',
            'Tablet': '📱',
            'CastAudio': '📻',
            'CastVideo': '📺',
            'Automobile': '🚗',
            'Unknown': '🎵'
        };
        return icons[type] || icons['Unknown'];
    }

    async transferPlayback(deviceId) {
        if (!this.isPremium) {
            this.showPremiumRequiredMessage('設備投放功能需要 Spotify Premium');
            return;
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch(`${this.apiBase}/api/player/transfer`, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ device_ids: [deviceId], play: true })
            });

            if (response.ok) {
                this.devicesModal.style.display = 'none';
                this.showSuccessMessage('✅ 已切換播放設備');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 2000);
            } else {
                const data = await response.json();
                this.showErrorMessage(data.error || '切換設備失敗');
            }
        } catch (error) {
            console.error('切換設備失敗:', error);
            this.showErrorMessage('切換設備失敗');
        }
    }

    async playTrack(trackId) {
        if (!this.isPremium) {
            this.showPremiumRequiredMessage('播放指定歌曲需要 Spotify Premium');
            return;
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch(`${this.apiBase}/api/player/play`, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
            });

            if (response.ok) {
                this.playlistModal.style.display = 'none';
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            }
        } catch (error) {
            console.error('播放歌曲失敗:', error);
        }
    }

    updateShuffleButton() {
        if (this.shuffleBtn) {
            const isSmartShuffle = this.smartShuffle || false;
            const isRegularShuffle = this.shuffleState && !isSmartShuffle;
            
            this.shuffleBtn.classList.remove('active');
            if (this.shuffleState) {
                this.shuffleBtn.classList.add('active');
            }
            
            if (isSmartShuffle) {
                this.shuffleBtn.title = '智慧隨機播放';
                this.shuffleBtn.style.setProperty('background', 'linear-gradient(135deg, #1db954, #1ed760)', 'important');
            } else if (isRegularShuffle) {
                this.shuffleBtn.title = '隨機播放';
                this.shuffleBtn.style.removeProperty('background');
            } else {
                this.shuffleBtn.title = '開啟隨機播放';
                this.shuffleBtn.style.removeProperty('background');
            }
        }
    }

    updateRepeatButton() {
        if (this.repeatBtn) {
            this.repeatBtn.classList.remove('active');
            if (this.repeatState !== 'off') {
                this.repeatBtn.classList.add('active');
            }
            
            const titles = {
                'off': '開啟重複播放',
                'context': '重複播放清單',
                'track': '單首重複播放'
            };
            this.repeatBtn.title = titles[this.repeatState] || '重複播放';
        }
    }

    updatePremiumButtons() {
        const premiumButtons = [this.shuffleBtn, this.repeatBtn, this.devicesBtn];
        premiumButtons.forEach(btn => {
            if (btn) {
                btn.classList.toggle('disabled', !this.isPremium);
            }
        });
    }

    showPremiumRequiredMessage(message) {
        this.showErrorMessage(`${message}\n請升級到 Spotify Premium 以使用此功能`);
    }

    showErrorMessage(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ff4757, #ff3742);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(255, 71, 87, 0.3);
            z-index: 1000;
            font-weight: 600;
            animation: slideIn 0.3s ease;
            max-width: 300px;
            white-space: pre-line;
        `;
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 300);
        }, 4000);
    }
}

// 初始化應用程式
document.addEventListener('DOMContentLoaded', () => {
    new SpotifyLyricsPlayer();
});

// 處理頁面可見性變化
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // 頁面隱藏時減少更新頻率
        if (window.spotifyPlayer && window.spotifyPlayer.updateInterval) {
            clearInterval(window.spotifyPlayer.updateInterval);
            window.spotifyPlayer.updateInterval = setInterval(() => {
                window.spotifyPlayer.checkCurrentTrack();
            }, 60000); // 60秒更新一次
        }
    } else {
        // 頁面顯示時恢復正常頻率
        if (window.spotifyPlayer && window.spotifyPlayer.updateInterval) {
            clearInterval(window.spotifyPlayer.updateInterval);
            window.spotifyPlayer.updateInterval = setInterval(() => {
                window.spotifyPlayer.checkCurrentTrack();
            }, 30000); // 30秒更新一次
        }
    }
});

// 儲存實例到全域變數以便調試
window.addEventListener('load', () => {
    if (!window.spotifyPlayer) {
        window.spotifyPlayer = new SpotifyLyricsPlayer();
    }
});