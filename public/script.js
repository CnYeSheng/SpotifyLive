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
        this.baseCheckInterval = 15000; // 基礎檢查間隔15秒
        this.currentCheckInterval = 15000; // 當前檢查間隔
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
        
        // Token 刷新控制
        this.tokenRefreshInterval = null;
        this.lastTokenRefresh = 0;
        this.isHandlingAuthError = false; // 防止重複處理認證錯誤
        this.tokenExpiryTime = null; // Token 過期時間
        this.consecutiveAuthErrors = 0; // 連續認證錯誤次數
        this.maxConsecutiveAuthErrors = 3; // 最大連續認證錯誤次數
        
        // 自動登入控制
        this.autoLoginInterval = null;
        this.autoLoginEnabled = true;
        
        // Podcast 檢測相關
        this.currentContentType = 'music'; // 'music' 或 'podcast'
        
        // 歌詞時間偏移控制
        this.lyricsTimeOffset = 0; // 毫秒，正數代表歌詞提前顯示，負數代表歌詞延後顯示
        
        // 手機頁面切換控制
        this.isMobile = window.innerWidth <= 767;
        this.currentMobilePage = 'info'; // 'info' 或 'lyrics'

        // 自動登入延遲控制
        this.autoLoginDelay = 2000; // 2秒延遲後自動登入
        this.autoLoginAttempted = false; // 防止重複自動登入
        
        // 下一首歌曲預覽控制
        this.nextSongPreviewTimeout = null; // 下一首歌曲預覽定時器
        this.isNextSongPreviewShown = false; // 下一首歌曲預覽是否顯示
        this.nextSongPreviewMode = localStorage.getItem('nextSongPreviewMode') || '10'; // '10', '20', '30', 'always', 'never'
        this.nextSongData = null; // 下一首歌曲數據

        // 日誌輔助函數
    this.log = (message, type = 'info') => {
        const now = new Date();

        // 轉換到台北時區
        const taipeiTime = new Date(
            now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
        );

        const year   = taipeiTime.getFullYear();
        const month  = String(taipeiTime.getMonth() + 1).padStart(2, '0');
        const day    = String(taipeiTime.getDate()).padStart(2, '0');
        const hour   = String(taipeiTime.getHours()).padStart(2, '0');
        const minute = String(taipeiTime.getMinutes()).padStart(2, '0');
        const second = String(taipeiTime.getSeconds()).padStart(2, '0');

        const timestamp = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
        console.log(`[${timestamp}] ${message}`);
    };

        
        // 检测运行环境
        this.isVercel = window.location.hostname.includes('vercel.app');
        this.isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('cyss.us.eu.org');
        this.isLiveWmcc = window.location.hostname.includes('live.wmcc.jp.eu.org');

        
        // 设置 API 基础路径
        if (this.isLocal) {
            this.apiBase = ''; // 本地开发环境
        } else if (this.isVercel) {
            this.apiBase = '/api'; // Vercel 环境
        } else if (this.isLiveWmcc) {
            this.apiBase = ''; // live.wmcc.jp.eu.org 环境，使用相对路径
        } else {
            this.apiBase = ''; // 其他环境，使用相对路径
        }
        
        // 调试信息
        console.log('🌐 环境检测:', {
            hostname: window.location.hostname,
            isLocal: this.isLocal,
            isVercel: this.isVercel,
            isLiveWmcc: this.isLiveWmcc,
            apiBase: this.apiBase,
            fullApiUrl: window.location.origin + this.apiBase,
            playEndpoint: window.location.origin + this.apiBase + '/api/play'
        });
        
        this.initializeElements();
        this.bindEvents();
        this.handleAuthCallback();
        this.checkAuthStatus();
        this.startAutoLoginTimer();
        
        // 初始化手機布局
        this.updateMobileLayout();
        
        // 設置全局播放器引用供手機控制使用
        window.player = this;
        
        // 頁面載入後自動嘗試登入（延遲2秒）
        this.scheduleAutoLogin();
    }

    handleAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'success') {
            this.sessionId = urlParams.get('session');
            if (this.sessionId) {
                localStorage.setItem('spotify_session_id', this.sessionId);
                this.log(`✅ 新 sessionId 已保存: ${this.sessionId.substring(0, 8)}...`);
            }
            window.history.replaceState({}, document.title, window.location.pathname);
            this.showSuccessMessage('🎉 Spotify 連接成功！');
        } else {
            // 嘗試從 localStorage 恢復 sessionId
            const storedSessionId = localStorage.getItem('spotify_session_id');
            if (storedSessionId) {
                this.sessionId = storedSessionId;
                this.log(`🔄 從 localStorage 恢復 sessionId: ${this.sessionId.substring(0, 8)}...`);
            } else {
                this.log('❌ 沒有找到保存的 sessionId');
            }
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
        
        // 下一首歌曲預覽元素
        this.nextSongPreview = document.getElementById('next-song-preview');
        this.nextSongCover = document.getElementById('next-song-cover');
        this.nextSongTitle = document.getElementById('next-song-title');
        this.nextSongArtist = document.getElementById('next-song-artist');
        this.nextSongSettingsBtn = document.getElementById('next-song-settings-btn');
        this.nextSongSettingsModal = document.getElementById('next-song-settings-modal');
        this.closeNextSongSettings = document.getElementById('close-next-song-settings');
        
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
            const authUrl = '/api/auth';
            this.log(`🔗 重定向到登入頁面: ${authUrl}`);
            window.location.href = authUrl;
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
            this.toggleLikedSongs();
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

        // 歌詞時間控制按鈕事件
        document.getElementById('lyrics-fast-btn')?.addEventListener('click', () => {
            this.adjustLyricsOffset(-500); // 快0.5秒
        });

        document.getElementById('lyrics-reset-btn')?.addEventListener('click', () => {
            this.resetLyricsOffset(); // 重置
        });

        document.getElementById('lyrics-slow-btn')?.addEventListener('click', () => {
            this.adjustLyricsOffset(500); // 慢0.5秒
        });

        // 歌詞搜尋按鈕事件
        document.getElementById('search-lyrics-btn')?.addEventListener('click', () => {
            this.showLyricsSearchModal();
        });

        // 歌詞搜尋模態框事件
        document.getElementById('close-lyrics-search-modal')?.addEventListener('click', () => {
            this.hideLyricsSearchModal();
        });

        document.getElementById('do-search-btn')?.addEventListener('click', () => {
            this.performLyricsSearch();
        });

        document.getElementById('search-current-btn')?.addEventListener('click', () => {
            this.searchCurrentTrackLyrics();
        });

        // 搜尋輸入框回車事件
        document.getElementById('lyrics-search-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performLyricsSearch();
            }
        });

        // 點擊模態框背景關閉
        document.getElementById('lyrics-search-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'lyrics-search-modal') {
                this.hideLyricsSearchModal();
            }
        });

        // 手機頁面切換按鈕事件
        document.getElementById('mobile-info-btn')?.addEventListener('click', () => {
            this.switchMobilePage('info');
        });

        document.getElementById('mobile-lyrics-btn')?.addEventListener('click', () => {
            this.switchMobilePage('lyrics');
        });

        // 響應式檢測
        window.addEventListener('resize', () => {
            const wasMobile = this.isMobile;
            this.isMobile = window.innerWidth <= 767;
            
            if (wasMobile !== this.isMobile) {
                this.updateMobileLayout();
            }
        });

        // 歌詞控制面板自動顯示/隱藏
        this.initLyricsControlsAutoHide();
        
        // 手機版歌詞控制觸發按鈕事件
        this.initMobileLyricsControlsTrigger();
        
        // 初始化手機滑動手勢
        this.initMobileSwipeGestures();
        
        // 初始化下一首歌曲預覽設定
        this.initNextSongPreviewSettings();
    }

    // 初始化下一首歌曲預覽設定
    initNextSongPreviewSettings() {
        // 設定按鈕事件
        this.nextSongSettingsBtn?.addEventListener('click', () => {
            this.showNextSongSettingsModal();
        });

        // 關閉模態框事件
        this.closeNextSongSettings?.addEventListener('click', () => {
            this.hideNextSongSettingsModal();
        });

        // 點擊背景關閉模態框
        this.nextSongSettingsModal?.addEventListener('click', (e) => {
            if (e.target === this.nextSongSettingsModal) {
                this.hideNextSongSettingsModal();
            }
        });

        // 監聽設定變更
        document.querySelectorAll('input[name="preview-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.updateNextSongPreviewMode(e.target.value);
                }
            });
        });

        // 恢復保存的設定
        this.restoreNextSongPreviewSettings();
        
        // 添加調試功能，按下 Ctrl+Shift+N 來測試下一首歌曲預覽
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'N') {
                this.testNextSongPreview();
            }
        });
    }

    // 顯示下一首歌曲設定模態框
    showNextSongSettingsModal() {
        this.nextSongSettingsModal.style.display = 'flex';
    }

    // 隱藏下一首歌曲設定模態框
    hideNextSongSettingsModal() {
        this.nextSongSettingsModal.style.display = 'none';
    }

    // 更新下一首歌曲預覽模式
    updateNextSongPreviewMode(mode) {
        this.nextSongPreviewMode = mode;
        localStorage.setItem('nextSongPreviewMode', mode);
        this.log(`🎵 下一首歌曲預覽模式已更新: ${mode}`);
        
        // 立即應用新設定
        this.applyNextSongPreviewMode();
        this.hideNextSongSettingsModal();
    }

    // 恢復下一首歌曲預覽設定
    restoreNextSongPreviewSettings() {
        const savedMode = this.nextSongPreviewMode;
        const radioBtn = document.querySelector(`input[name="preview-mode"][value="${savedMode}"]`);
        if (radioBtn) {
            radioBtn.checked = true;
        }
        this.applyNextSongPreviewMode();
    }

    // 應用下一首歌曲預覽模式
    applyNextSongPreviewMode() {
        if (this.nextSongPreviewMode === 'never') {
            this.hideNextSongPreview();
        } else if (this.nextSongPreviewMode === 'always' && this.nextSongData) {
            this.showNextSongPreview();
        } else {
            // 其他模式會在 processTrackData 中處理
            this.scheduleNextSongPreview();
        }
    }

    // 顯示下一首歌曲預覽
    showNextSongPreview() {
        if (this.nextSongPreviewMode === 'never' || !this.nextSongData) {
            return;
        }

        // 更新預覽內容
        this.updateNextSongPreviewContent();
        
        // 顯示預覽
        if (this.nextSongPreview) {
            this.nextSongPreview.style.display = 'block';
            this.isNextSongPreviewShown = true;
            this.log('🎵 顯示下一首歌曲預覽');
        }
    }

    // 隱藏下一首歌曲預覽
    hideNextSongPreview() {
        if (this.nextSongPreview) {
            this.nextSongPreview.style.display = 'none';
            this.isNextSongPreviewShown = false;
        }
        
        // 清除定時器
        if (this.nextSongPreviewTimeout) {
            clearTimeout(this.nextSongPreviewTimeout);
            this.nextSongPreviewTimeout = null;
        }
    }

    // 更新下一首歌曲預覽內容
    updateNextSongPreviewContent() {
        if (!this.nextSongData) return;

        const { name, artists, album } = this.nextSongData;
        
        if (this.nextSongTitle) {
            this.nextSongTitle.textContent = name || '未知歌曲';
        }
        
        if (this.nextSongArtist) {
            const artistNames = artists ? artists.map(artist => artist.name).join(', ') : '未知藝人';
            this.nextSongArtist.textContent = artistNames;
        }
        
        if (this.nextSongCover && album && album.images && album.images.length > 0) {
            this.nextSongCover.src = album.images[0].url;
        } else if (this.nextSongCover) {
            this.nextSongCover.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMjAgMGMxMSAwIDIwIDkgMjAgMjBzLTkgMjAtMjAgMjBTMCAzMSAwIDIwIDkgMCAyMCAweiIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjIwIiB5PSIyNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn461PC90ZXh0Pjwvc3ZnPg==';
        }
    }

    // 安排下一首歌曲預覽
    scheduleNextSongPreview() {
        if (!this.currentTrack || this.nextSongPreviewMode === 'never') {
            return;
        }

        // 清除之前的定時器
        if (this.nextSongPreviewTimeout) {
            clearTimeout(this.nextSongPreviewTimeout);
            this.nextSongPreviewTimeout = null;
        }

        const currentTime = this.currentTrack.progress_ms || 0;
        const duration = this.currentTrack.item?.duration_ms || 0;
        
        if (duration === 0) return;

        const remainingTime = duration - currentTime;
        
        // 根據預覽模式決定顯示時機
        let showAtSeconds = 10; // 預設10秒
        if (this.nextSongPreviewMode === '20') showAtSeconds = 20;
        else if (this.nextSongPreviewMode === '30') showAtSeconds = 30;
        
        const showAtMs = showAtSeconds * 1000;
        
        if (this.nextSongPreviewMode === 'always') {
            // 始終顯示模式
            if (this.nextSongData) {
                this.showNextSongPreview();
            }
        } else if (remainingTime <= showAtMs && !this.isNextSongPreviewShown) {
            // 時間到了立即顯示
            if (this.nextSongData) {
                this.showNextSongPreview();
            }
        } else if (remainingTime > showAtMs) {
            // 設定定時器在指定時間顯示
            const timeToShow = remainingTime - showAtMs;
            this.nextSongPreviewTimeout = setTimeout(() => {
                if (this.nextSongData) {
                    this.showNextSongPreview();
                }
            }, timeToShow);
        }
    }

    // 獲取下一首歌曲信息
    async fetchNextSongData() {
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }
            
            const response = await fetch(`${this.apiBase}/api/player/queue`, { headers });
            
            if (response.ok) {
                const queueData = await response.json();
                if (queueData.queue && queueData.queue.length > 0) {
                    this.nextSongData = queueData.queue[0];
                    this.log('🎵 獲取下一首歌曲信息成功');
                    return true;
                }
            }
        } catch (error) {
            this.log(`❌ 獲取下一首歌曲信息失敗: ${error.message}`);
        }
        
        this.nextSongData = null;
        return false;
    }

    // 測試下一首歌曲預覽功能（調試用）
    testNextSongPreview() {
        this.log('🧪 測試下一首歌曲預覽功能');
        
        // 如果有當前歌曲，使用它作為測試數據
        if (this.currentTrack && this.currentTrack.item) {
            this.nextSongData = {
                name: this.currentTrack.item.name + ' (下一首)',
                artists: this.currentTrack.item.artists,
                album: this.currentTrack.item.album
            };
        } else {
            // 創建默認測試數據
            this.nextSongData = {
                name: '測試歌曲 - 下一首預覽',
                artists: [{ name: '測試藝人' }],
                album: {
                    images: [{ url: 'https://via.placeholder.com/300x300/1db954/ffffff?text=Next+Song' }]
                }
            };
        }
        
        // 強制顯示預覽
        this.showNextSongPreview();
        
        // 顯示提示
        const testDiv = document.createElement('div');
        testDiv.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(29, 185, 84, 0.9);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 2000;
            font-size: 14px;
            font-weight: 500;
        `;
        testDiv.innerHTML = '🧪 測試下一首歌曲預覽<br>按 Ctrl+Shift+N 測試 | 按 Ctrl+Shift+H 隱藏';
        document.body.appendChild(testDiv);
        
        setTimeout(() => {
            if (testDiv.parentNode) {
                testDiv.parentNode.removeChild(testDiv);
            }
        }, 3000);
    }

    // 隱藏測試預覽（調試用）
    hideTestNextSongPreview() {
        this.hideNextSongPreview();
        this.nextSongData = null;
        this.log('🧪 隱藏測試預覽');
    }

    async checkAuthStatus() {
        try {
            // 確保有 sessionId 才進行檢查
            if (!this.sessionId) {
                const storedSessionId = localStorage.getItem('spotify_session_id');
                if (storedSessionId) {
                    this.sessionId = storedSessionId;
                    this.log(`🔄 checkAuthStatus 恢復 sessionId: ${this.sessionId.substring(0, 8)}...`);
                } else {
                    this.log('❌ checkAuthStatus 沒有 sessionId，顯示登入頁面');
                    this.showAuthSection();
                    return;
                }
            }
            
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
                this.log(`🔍 使用 sessionId 檢查認證狀態: ${this.sessionId.substring(0, 8)}...`);
            }
            
            const response = await fetch('/api/auth-status', { headers });
            const data = await response.json();
            
            if (data.authenticated) {
                if (data.sessionId && !this.sessionId) {
                    this.sessionId = data.sessionId;
                    localStorage.setItem('spotify_session_id', this.sessionId);
                    this.log(`✅ 從服務端獲得新 sessionId: ${this.sessionId.substring(0, 8)}...`);
                }
                this.log('✅ 認證狀態有效，啟動播放器');
                this.showPlayerSection();
                
                // 立即進行一次檢查，然後啟動定時器
                this.log('🚀 立即執行首次當前歌曲檢查');
                this.checkCurrentTrackWithRateLimit();
                
                this.startTracking();
                this.startTokenRefreshTimer();
            } else {
                this.log('❌ 認證狀態無效，清除 sessionId');
                this.showAuthSection();
                localStorage.removeItem('spotify_session_id');
                this.sessionId = null;
            }
        } catch (error) {
            this.log(`❌ 檢查認證狀態失敗: ${error.message}`);
            this.showAuthSection();
        }
    }

    async handleAuthError() {
        // 防止重複處理認證錯誤
        if (this.isHandlingAuthError) {
            this.log('⏳ 正在處理認證錯誤，跳過重複請求');
            return false;
        }
        
        this.isHandlingAuthError = true;
        this.log('🔍 處理認證錯誤...');
        
        try {
            // 檢查是否有 sessionId，如果沒有嘗試從 localStorage 恢復
            if (!this.sessionId) {
                const storedSessionId = localStorage.getItem('spotify_session_id');
                if (storedSessionId) {
                    this.sessionId = storedSessionId;
                    this.log(`🔄 從 localStorage 恢復 sessionId: ${this.sessionId.substring(0, 8)}...`);
                } else {
                    this.log('❌ 沒有 sessionId，需要重新登入');
                    this.showAuthSection();
                    localStorage.removeItem('spotify_session_id');
                    return false;
                }
            }

            // 靜默檢查認證狀態，不改變UI
            const response = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    this.log('🔑 認證狀態檢查返回 401，嘗試等待服務端刷新...');
                    // 等待服務端可能的 token 刷新
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    // 再次嘗試檢查
                    try {
                        const retryResponse = await fetch('/api/auth-status', {
                            headers: { 'X-Session-Id': this.sessionId }
                        });
                        
                        if (retryResponse.ok) {
                            const retryData = await retryResponse.json();
                            if (retryData.authenticated) {
                                this.log('✅ 服務端 token 刷新成功');
                                return true;
                            }
                        }
                    } catch (retryError) {
                        this.log(`❌ 重試認證檢查失敗: ${retryError.message}`);
                    }
                }
                
                this.log('❌ 認證狀態檢查失敗，需要重新登入');
                this.showAuthSection();
                this.stopTracking();
                localStorage.removeItem('spotify_session_id');
                this.sessionId = null;
                return false;
            }
            
            const data = await response.json();
            
            if (!data.authenticated) {
                this.log('❌ Session 已失效，需要重新登入');
                this.showAuthSection();
                this.scheduleAutoLogin();
                this.stopTracking();
                localStorage.removeItem('spotify_session_id');
                this.sessionId = null;
                return false;
            }
            
            this.log('✅ Session 有效，等待服務端 token 刷新...');
            
            // 等待服務端處理 token 刷新，不顯示登入頁面
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            this.log('✅ 認證錯誤處理完成，繼續正常操作');
            return true;
            
        } catch (error) {
            this.log(`❌ 認證處理失敗: ${error.message}`);
            // 只有在真正失敗時才顯示登入頁面
            this.showAuthSection();
            this.stopTracking();
            localStorage.removeItem('spotify_session_id');
            this.sessionId = null;
            return false;
        } finally {
            // 重置認證處理狀態，延長時間避免頻繁重試
            setTimeout(() => {
                this.isHandlingAuthError = false;
            }, 5000); // 5秒後允許再次處理認證錯誤
        }
    }

    updateLikeButtonState(isLiked) {
        if (this.addToPlaylistBtn) {
            this.addToPlaylistBtn.classList.toggle('active', isLiked);
            this.addToPlaylistBtn.classList.toggle('liked', isLiked);
            
            if (isLiked) {
                this.addToPlaylistBtn.title = '點擊從喜歡的歌曲中移除';
                this.addToPlaylistBtn.innerHTML = '❤️';
                // 添加動畫效果
                this.addToPlaylistBtn.style.animation = 'heartbeat 0.6s ease-in-out';
                setTimeout(() => {
                    if (this.addToPlaylistBtn) {
                        this.addToPlaylistBtn.style.animation = '';
                    }
                }, 600);
            } else {
                this.addToPlaylistBtn.title = '點擊加入喜歡的歌曲';
                this.addToPlaylistBtn.innerHTML = '🤍';
            }
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

    showNoMusicSection(message = null) {
        this.authSection.style.display = 'none';
        this.playerSection.style.display = 'none';
        this.noMusicSection.style.display = 'flex';
        
        // 更新無音樂區域的消息
        const noMusicCard = this.noMusicSection.querySelector('.no-music-card');
        if (noMusicCard && message) {
            const messageElement = noMusicCard.querySelector('p') || document.createElement('p');
            messageElement.textContent = message;
            if (!noMusicCard.contains(messageElement)) {
                const h2 = noMusicCard.querySelector('h2');
                if (h2) {
                    h2.insertAdjacentElement('afterend', messageElement);
                } else {
                    noMusicCard.appendChild(messageElement);
                }
            }
        }
        
        this.updateStatus('spotify', true);
        this.currentTrack = null; // 清空當前歌曲數據
    }

    startTracking() {
        this.log(`🔄 開始追蹤當前播放狀態，間隔: ${this.currentCheckInterval}ms`);
        this.checkCurrentTrackWithRateLimit();
        // 使用動態檢查間隔
        this.updateInterval = setInterval(() => {
            this.log(`⏰ 定時檢查觸發 (間隔: ${this.currentCheckInterval}ms)`);
            this.checkCurrentTrackWithRateLimit();
        }, this.currentCheckInterval);
        this.log(`✅ 追蹤定時器已設置`);
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
        
        // 如果接近歌曲結尾，密集更新（每5秒）
        if (this.isNearTrackEnd) {
            newInterval = 5000; // 5秒密集更新
        }
        // 如果最近有用戶操作，短暫加速
        else if (Date.now() - this.lastUserAction < 30000) {
            newInterval = 10000; // 10秒
        }
        // 如果被限速過，延長間隔
        else if (this.rateLimitCount > 0) {
            newInterval = Math.min(this.baseCheckInterval * (1 + this.rateLimitCount * 0.5), 30000);
        }
        
        if (newInterval !== this.currentCheckInterval) {
            this.currentCheckInterval = newInterval;
            this.log(`🔄 調整輪詢間隔為 ${newInterval / 1000} 秒`);
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
        if (this.nextSongPreviewTimeout) {
            clearTimeout(this.nextSongPreviewTimeout);
            this.nextSongPreviewTimeout = null;
        }
        if (this.lyricsLoadTimeout) {
            clearTimeout(this.lyricsLoadTimeout);
            this.lyricsLoadTimeout = null;
        }
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
            this.tokenRefreshInterval = null;
        }
        if (this.autoLoginInterval) {
            clearInterval(this.autoLoginInterval);
            this.autoLoginInterval = null;
        }
    }

    startTokenRefreshTimer() {
        // 每 30 分鐘檢查一次 token 狀態
        this.tokenRefreshInterval = setInterval(() => {
            this.proactiveTokenRefresh();
        }, 30 * 60 * 1000); // 30 分鐘
        
        this.log('🔄 Token 刷新定時器已啟動 (每 30 分鐘檢查一次)');
    }

    // 自動登入定時器 - 每 15 分鐘更新一次 session
    startAutoLoginTimer() {
        if (!this.autoLoginEnabled) return;
        
        this.autoLoginInterval = setInterval(() => {
            this.log('⏰ 15分鐘 Session 更新檢查');
            this.performSessionRefresh();
        }, 15 * 60 * 1000); // 15 分鐘
        
        this.log('🔄 Session 更新定時器已啟動 (每 15 分鐘檢查一次)');
    }

    // 執行自動登入
    async performAutoLogin() {
        if (!this.autoLoginEnabled) return;
        
        this.log('🔐 開始自動登入流程...');
        
        try {
            // 檢查當前認證狀態
            const authResponse = await fetch('/api/auth-status', {
                headers: this.sessionId ? { 'X-Session-Id': this.sessionId } : {}
            });
            
            const authData = await authResponse.json();
            
            if (!authData.authenticated) {
                this.log('🔑 認證已失效，觸發自動登入');
                // 如果未認證，自動觸發登入流程
                const authUrl = '/api/auth';
                this.log(`🔗 自動重定向到登入頁面: ${authUrl}`);
                window.location.href = authUrl;
            } else {
                this.log('✅ 認證狀態正常，無需重新登入');
                // 可選：刷新當前播放狀態
                this.checkCurrentTrackWithRateLimit();
            }
        } catch (error) {
            this.log(`❌ 自動登入檢查失敗: ${error.message}`);
        }
    }

    // 執行 Session 刷新（每15分鐘）
    async performSessionRefresh() {
        if (!this.sessionId) {
            this.log('⚠️ 沒有 sessionId，跳過 Session 刷新');
            return;
        }
        
        this.log('🔄 開始 Session 刷新檢查...');
        
        try {
            // 顯示動態刷新效果
            this.showSessionRefreshAnimation();
            
            // 檢查當前認證狀態
            const authResponse = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            const authData = await authResponse.json();
            
            if (authData.authenticated) {
                this.log('✅ Session 仍然有效，刷新成功');
                // 更新最後刷新時間
                this.lastTokenRefresh = Date.now();
                
                // 如果有新的 sessionId，更新它
                if (authData.sessionId && authData.sessionId !== this.sessionId) {
                    this.sessionId = authData.sessionId;
                    localStorage.setItem('spotify_session_id', this.sessionId);
                    this.log(`🔄 Session ID 已更新: ${this.sessionId.substring(0, 8)}...`);
                }
                
                // 顯示成功動畫
                this.showSessionRefreshSuccess();
                
                // 主動觸發 token 刷新（類似自動登入）
                this.log('🔄 主動觸發 Token 刷新...');
                await this.triggerTokenRefresh();
            } else {
                this.log('⚠️ Session 已失效，需要重新認證');
                // 嘗試智能恢復
                const recovered = await this.attemptSmartRecovery();
                if (!recovered) {
                    this.log('❌ Session 刷新失敗，需要重新登入');
                    this.showSessionRefreshFailed();
                }
            }
        } catch (error) {
            this.log(`❌ Session 刷新失敗: ${error.message}`);
            this.showSessionRefreshFailed();
        }
    }

    // 主動觸發 Token 刷新（類似自動登入）
    async triggerTokenRefresh() {
        this.log('🔑 開始主動 Token 刷新流程...');
        
        try {
            // 嘗試一個輕量級的 API 調用來觸發服務端 token 刷新
            const response = await fetch(`${this.apiBase}/api/current-track`, {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.status === 401) {
                this.log('⚠️ Token 需要刷新，嘗試自動恢復...');
                
                // 等待服務端可能的自動刷新
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 再次嘗試
                const retryResponse = await fetch(`${this.apiBase}/api/current-track`, {
                    headers: { 'X-Session-Id': this.sessionId }
                });
                
                if (retryResponse.ok) {
                    this.log('✅ Token 自動刷新成功');
                    this.showTokenRefreshSuccess();
                } else {
                    this.log('⚠️ Token 自動刷新可能需要重新登入');
                }
            } else if (response.ok) {
                this.log('✅ Token 狀態良好，無需刷新');
            }
        } catch (error) {
            this.log(`❌ Token 刷新觸發失敗: ${error.message}`);
        }
    }

    // 顯示 Token 刷新成功
    showTokenRefreshSuccess() {
        const successDiv = document.createElement('div');
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #1db954, #1ed760);
            color: white;
            padding: 10px 16px;
            border-radius: 20px;
            box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
            z-index: 1500;
            font-weight: 500;
            font-size: 12px;
            animation: tokenRefreshSuccess 0.4s ease-out;
        `;
        successDiv.innerHTML = '🔑 Token 已自動刷新';
        
        document.body.appendChild(successDiv);
        
        // 2秒後自動移除
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.style.animation = 'tokenRefreshSuccess 0.3s ease-in reverse';
                setTimeout(() => {
                    if (successDiv.parentNode) {
                        successDiv.parentNode.removeChild(successDiv);
                    }
                }, 300);
            }
        }, 2000);
    }

    // 顯示 Session 刷新動畫
    showSessionRefreshAnimation() {
        const refreshDiv = document.createElement('div');
        refreshDiv.id = 'session-refresh-animation';
        refreshDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #1db954, #1ed760);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            box-shadow: 0 4px 15px rgba(29, 185, 84, 0.3);
            z-index: 1500;
            font-weight: 500;
            font-size: 14px;
            animation: sessionRefreshPulse 2s ease-in-out infinite;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        refreshDiv.innerHTML = `
            <div class="refresh-spinner" style="
                width: 16px;
                height: 16px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top: 2px solid white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            正在更新 Session...
        `;
        
        // 添加動畫樣式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes sessionRefreshPulse {
                0%, 100% { opacity: 0.8; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.05); }
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(refreshDiv);
        
        // 2秒後自動移除
        setTimeout(() => {
            if (refreshDiv.parentNode) {
                refreshDiv.parentNode.removeChild(refreshDiv);
            }
        }, 2000);
    }

    // 顯示 Session 刷新成功
    showSessionRefreshSuccess() {
        const successDiv = document.createElement('div');
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #1db954, #1ed760);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            box-shadow: 0 4px 15px rgba(29, 185, 84, 0.3);
            z-index: 1500;
            font-weight: 500;
            font-size: 14px;
            animation: sessionRefreshSuccess 0.5s ease-out;
        `;
        successDiv.innerHTML = '✅ Session 更新成功';
        
        document.body.appendChild(successDiv);
        
        // 1.5秒後自動移除
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.style.animation = 'sessionRefreshSuccess 0.3s ease-in reverse';
                setTimeout(() => {
                    if (successDiv.parentNode) {
                        successDiv.parentNode.removeChild(successDiv);
                    }
                }, 300);
            }
        }, 1500);
    }

    // 顯示 Session 刷新失敗
    showSessionRefreshFailed() {
        const failedDiv = document.createElement('div');
        failedDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ff4757, #ff3742);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            box-shadow: 0 4px 15px rgba(255, 71, 87, 0.3);
            z-index: 1500;
            font-weight: 500;
            font-size: 14px;
            animation: sessionRefreshFailed 0.5s ease-out;
        `;
        failedDiv.innerHTML = '❌ Session 更新失敗';

        // 顯示自動登入提示
                scheduleAutoLogin();
        
        document.body.appendChild(failedDiv);
        
        // 3秒後自動移除
        setTimeout(() => {
            if (failedDiv.parentNode) {
                failedDiv.style.animation = 'sessionRefreshFailed 0.3s ease-in reverse';
                setTimeout(() => {
                    if (failedDiv.parentNode) {
                        failedDiv.parentNode.removeChild(failedDiv);
                    }
                }, 300);
            }
        }, 3000);
    }

    // 頁面載入後自動嘗試登入
    scheduleAutoLogin() {
        // 防止重複自動登入
        /* if (this.autoLoginAttempted) {
            this.log('⏭️ 自動登入已嘗試過，跳過');
            return;
        } */
        
        this.autoLoginAttempted = true;
        
        // 延遲2秒後執行自動登入，讓頁面完全載入
        setTimeout(() => {
            this.log('🚀 頁面載入完成，準備自動登入檢查...');
            
            // 首先檢查是否已經有有效的認證
            if (this.sessionId) {
                this.log('✅ 已有 sessionId，跳過自動登入');
                return;
            }
            
            // 檢查是否顯示登入頁面（表示未認證）
            if (this.authSection && this.authSection.style.display !== 'none') {
                this.log('🔍 檢測到登入頁面，執行自動登入...');
                
                // 顯示自動登入提示
                this.showAutoLoginMessage();
                
                // 延遲1秒後執行自動登入
                setTimeout(() => {
                    const authUrl = '/api/auth';
                    this.log(`🔗 自動重定向到登入頁面: ${authUrl}`);
                    window.location.href = authUrl;
                }, 1000);
            } else {
                this.log('✅ 已認證或正在載入中，無需自動登入');
            }
        }, this.autoLoginDelay);
    }

    // 顯示自動登入提示
    showAutoLoginMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #1db954, #1ed760);
            color: white;
            padding: 20px 30px;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(29, 185, 84, 0.4);
            z-index: 2000;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            animation: fadeInOut 3s ease-in-out;
        `;
        messageDiv.innerHTML = '🎵 正在自動連接 Spotify...<br><small>即將跳轉到登入頁面</small>';
        
        // 添加動畫樣式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(messageDiv);
        
        // 3秒後移除提示
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }

    async proactiveTokenRefresh() {
        if (!this.sessionId) return;
        
        const now = Date.now();
        // 避免過於頻繁的刷新請求
        if (now - this.lastTokenRefresh < 10 * 60 * 1000) {
            return;
        }
        
        this.log('🔄 執行主動 token 檢查...');
        this.lastTokenRefresh = now;
        
        try {
            // 嘗試一個輕量級的 API 調用來觸發 token 刷新
            const response = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    this.log('✅ Token 狀態良好');
                } else {
                    this.log('⚠️ 認證狀態異常，可能需要重新登入');
                }
            }
        } catch (error) {
            this.log(`❌ 主動 token 檢查失敗: ${error.message}`);
        }
    }

    // 添加速率限制檢查
    checkCurrentTrackWithRateLimit() {
        const now = Date.now();
        this.log(`🔍 檢查當前播放狀態 (lastCheckTime: ${this.lastCheckTime}, interval: ${this.currentCheckInterval})`);
        
        // 檢查是否在速率限制期間
        if (this.isRateLimited && now < this.retryAfterUntil) {
            const waitSec = Math.ceil((this.retryAfterUntil - now) / 1000);
            this.log(`⏸️ 速率限制中，還需等待 ${waitSec} 秒`);
            return;
        }
        
        // 如果速率限制已過期，重置狀態
        if (this.isRateLimited && now >= this.retryAfterUntil) {
            this.isRateLimited = false;
            this.log('✅ 速率限制已解除');
        }
        
        // 如果正在檢查中，跳過
        if (this.isCheckingTrack) {
            this.log('⏳ 正在檢查中，跳過此次請求');
            return;
        }
        
        // 檢查最小間隔
        const timeSinceLastCheck = now - this.lastCheckTime;
        if (timeSinceLastCheck < this.currentCheckInterval) {
            this.log(`⏳ 間隔時間不足，跳過此次請求 (已過 ${timeSinceLastCheck}ms，需要 ${this.currentCheckInterval}ms)`);
            return;
        }
        
        this.log('✅ 通過所有檢查，開始 API 調用');
        this.lastCheckTime = now;
        this.checkCurrentTrack();
    }

    async checkCurrentTrack() {
        this.log('🔎 開始執行 checkCurrentTrack()');
        // 防止重複請求
        if (this.isCheckingTrack) {
            this.log('⚠️ 重複請求，直接返回');
            return;
        }
        
        this.isCheckingTrack = true;
        this.log('🔒 設置檢查狀態鎖定');
        
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }
            
            const response = await fetch(`${this.apiBase}/api/current-track`, { headers });
            
            // 處理認證錯誤
            if (response.status === 401) {
                this.consecutiveAuthErrors++;
                this.log(`🔑 檢測到認證問題 (第 ${this.consecutiveAuthErrors} 次)`);
                
                try {
                    const errorData = await response.json();
                    if (errorData.needsAuth) {
                        this.log('❌ 需要重新認證，觸發登入流程');
                        this.handleAuthError();
                        return;
                    }
                } catch (e) {
                    // JSON 解析失敗，繼續處理
                }
                
                // 嘗試智能恢復
                if (this.consecutiveAuthErrors <= 3) {
                    this.log('🔧 嘗試智能恢復...');
                    this.scheduleAutoLogin();
                    const recovered = await this.attemptSmartRecovery();
                    if (recovered) {
                        this.log('✅ 智能恢復成功');
                        this.consecutiveAuthErrors = 0;
                        return;
                    }
                }
                
                this.log('❌ 需要重新登入');
                this.handleAuthError();
                return;
            }
            
            // 處理其他 HTTP 錯誤狀態
            if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                this.log(`🚫 訪問被拒絕: ${errorData.message || '可能需要 Spotify Premium 或額外權限'}`);
                this.updateStatus('spotify', false);
                return;
            }
            
            if (response.status === 502 || response.status >= 500) {
                const errorData = await response.json().catch(() => ({}));
                this.log(`🔥 服務器錯誤 (${response.status}): ${errorData.message || 'Spotify 服務暫時不可用'}`);
                this.updateStatus('spotify', false);
                this.scheduleRetry(10000); // 10秒後重試
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
            this.log(`📥 API 響應: ${JSON.stringify({
                isPlaying: data.isPlaying,
                hasName: !!data.name,
                hasMessage: !!data.message
            })}`);
            this.processTrackData(data);

        } catch (error) {
            this.log(`❌ 獲取當前播放失敗: ${error.message}`);
            this.updateStatus('spotify', false);
            // 如果是認證錯誤，嘗試修復
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                this.log('🔑 檢測到認證相關錯誤，嘗試修復...');
                this.handleAuthError();
                this.scheduleAutoLogin();
            }
        } finally {
            this.isCheckingTrack = false;
            this.log('🔓 檢查狀態鎖定已解除');
        }
    }

    // 增強的智能恢復方法
    async attemptSmartRecovery() {
        this.log('🔧 開始增強智能恢復流程...');
        
        // 步驟 1: 立即嘗試服務端 token 刷新（無需等待）
        this.log('🔄 立即嘗試服務端 token 刷新...');
        try {
            this.scheduleAutoLogin();
            const refreshResponse = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (refreshResponse.ok) {
                const refreshData = await refreshResponse.json();
                if (refreshData.authenticated) {
                    this.log('✅ 服務端 token 刷新成功');
                    
                    // 如果有新的 sessionId，更新它
                    if (refreshData.sessionId && refreshData.sessionId !== this.sessionId) {
                        this.sessionId = refreshData.sessionId;
                        localStorage.setItem('spotify_session_id', this.sessionId);
                        this.log(`🔄 Session ID 已更新: ${this.sessionId.substring(0, 8)}...`);
                    }
                    
                    // 立即測試新 token
                    const testResponse = await fetch(`${this.apiBase}/api/current-track`, {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    
                    if (testResponse.ok) {
                        const data = await testResponse.json();
                        this.processTrackData(data);
                        this.log('✅ 增強智能恢復成功');
                        return true;
                    }
                }
            }
        } catch (error) {
            this.log(`❌ 立即刷新失敗: ${error.message}`);
        }
        
        // 步驟 2: 漸進式重試策略
        this.log('🔄 執行漸進式重試策略...');
        const retryDelays = [1000, 2000, 3000, 5000]; // 漸進式延遲
        
        for (let i = 0; i < retryDelays.length; i++) {
            const delay = retryDelays[i];
            this.log(`⏳ 第 ${i + 1} 次重試，等待 ${delay}ms...`);
            this.scheduleAutoLogin();
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                // 嘗試多個端點來觸發刷新
                const endpoints = [
                    `${this.apiBase}/api/auth-status`,
                    `${this.apiBase}/api/current-track`,
                    `${this.apiBase}/api/health`
                ];
                
                for (const endpoint of endpoints) {
                    try {
                        const response = await fetch(endpoint, {
                            headers: { 'X-Session-Id': this.sessionId }
                        });
                        
                        if (response.ok) {
                            if (endpoint === `${this.apiBase}/api/current-track`) {
                                const data = await response.json();
                                if (data.name) {
                                    this.processTrackData(data);
                                    this.log(`✅ 通過 ${endpoint} 恢復成功`);
                                    return true;
                                }
                            } else {
                                this.log(`✅ 通過 ${endpoint} 觸發刷新成功`);
                                
                                // 立即測試主要端點
                                const testResponse = await fetch(`${this.apiBase}/api/current-track`, {
                                    headers: { 'X-Session-Id': this.sessionId }
                                });
                                
                                if (testResponse.ok) {
                                    const data = await testResponse.json();
                                    this.processTrackData(data);
                                    this.log('✅ 增強智能恢復最終成功');
                                    return true;
                                }
                            }
                        }
                    } catch (endpointError) {
                        this.log(`⚠️ 端點 ${endpoint} 失敗: ${endpointError.message}`);
                        this.scheduleAutoLogin();
                    }
                }
            } catch (retryError) {
                this.log(`⚠️ 第 ${i + 1} 次重試失敗: ${retryError.message}`);
                this.scheduleAutoLogin();
            }
        }
        
        // 步驟 3: 最後的恢復嘗試 - 檢查 session 有效性
        this.log('🔍 執行最終 session 有效性檢查...');
        try {
            this.scheduleAutoLogin();
            // 嘗試從 localStorage 恢復 session
            const storedSessionId = localStorage.getItem('spotify_session_id');
            if (storedSessionId && storedSessionId !== this.sessionId) {
                this.sessionId = storedSessionId;
                this.log(`🔄 從 localStorage 恢復不同 session: ${this.sessionId.substring(0, 8)}...`);
                
                const finalTestResponse = await fetch(`${this.apiBase}/api/current-track`, {
                    headers: { 'X-Session-Id': this.sessionId }
                });
                
                if (finalTestResponse.ok) {
                    const data = await finalTestResponse.json();
                    this.processTrackData(data);
                    this.log('✅ 通過 session 恢復成功');
                    return true;
                }
            }
        } catch (finalError) {
            this.log(`❌ 最終恢復失敗: ${finalError.message}`);
            this.scheduleAutoLogin();
        }
        
        this.log('❌ 增強智能恢復失敗');
        return false;
    }

    // 檢測內容類型 (音樂 vs Podcast)
    detectContentType(track) {
        if (!track) return 'music';
        
        // 檢查 track type
        if (track.type === 'episode') {
            return 'podcast';
        }
        
        // 檢查 album type
        if (track.album && track.album.album_type === 'podcast') {
            return 'podcast';
        }
        
        // 檢查持續時間 (Podcast 通常較長)
        if (track.duration_ms > 10 * 60 * 1000) { // 超過10分鐘
            // 進一步檢查其他指標
            const artistName = track.artists?.[0]?.name?.toLowerCase() || '';
            const albumName = track.album?.name?.toLowerCase() || '';
            const trackName = track.name?.toLowerCase() || '';
            
            // 關鍵字檢測
            const podcastKeywords = [
                'podcast', 'episode', 'ep.', 'season', 'interview', 
                '访谈', '节目', '播客', '對談', '專訪', 'talk', 'show'
            ];
            
            const textToCheck = `${artistName} ${albumName} ${trackName}`;
            const hasPodcastKeywords = podcastKeywords.some(keyword => 
                textToCheck.includes(keyword)
            );
            
            if (hasPodcastKeywords) {
                return 'podcast';
            }
        }
        
        return 'music';
    }

    // 處理歌曲數據的統一方法
    processTrackData(data) {
        this.log(`🎯 開始處理歌曲數據: ${JSON.stringify({ 
            hasName: !!data.name, 
            isPlaying: data.isPlaying,
            hasId: !!data.id 
        })}`);
        
        // 如果歌曲發生變化，隱藏之前的預覽並重置狀態
        const currentId = this.currentTrack?.id || this.currentTrack?.item?.id;
        const newId = data.id || data.item?.id;
        
        if (this.currentTrack && currentId !== newId) {
            this.isNextSongPreviewShown = false;
            this.hideNextSongPreview();
            this.log('🎵 歌曲變化，重置下一首歌曲預覽狀態');
        }

        // 更新 currentTrack
        this.currentTrack = data;
        this.log(`🎵 歌曲數據已更新: ${data.name || 'Unknown'} - ${data.artist || 'Unknown Artist'}`);

        // 獲取下一首歌曲信息（異步操作，不阻塞主流程）
        this.fetchNextSongData().then((success) => {
            if (success) {
                this.log('🎵 下一首歌曲信息獲取成功，安排預覽');
                // 安排下一首歌曲預覽
                this.scheduleNextSongPreview();
            } else {
                this.log('⚠️ 下一首歌曲信息獲取失敗或隊列為空');
            }
        });

        // 如果是始終顯示模式，立即顯示（如果有數據）
        if (this.nextSongPreviewMode === 'always' && this.nextSongData) {
            this.showNextSongPreview();
        }
        // 重置重試計數器和認證錯誤計數
        this.retryCount = 0;
        this.consecutiveAuthErrors = 0;
        
        // 處理無音樂播放的情況
        if (!data.name || data.name === null || !data.isPlaying) {
            this.log('🔍 沒有檢測到正在播放的音樂');
            let message = '請在 Spotify 中開始播放音樂';
            if (data.message) {
                this.log(`📝 服務端消息: ${data.message}`);
                message = data.message;
            }
            this.showNoMusicSection(message);
            return;
        }

        this.log('✅ 檢測到正在播放的音樂，繼續處理...');

        const isNewTrack = !this.currentTrack || 
                          this.currentTrack.id !== data.id ||
                          this.currentTrack.name !== data.name;

        this.log(`🔄 歌曲狀態: ${isNewTrack ? '新歌曲' : '相同歌曲'}`);

        // 檢測內容類型並添加到數據中
        if (!data.contentType) {
            data.contentType = this.detectContentType(data);
        }
        this.currentContentType = data.contentType;
        this.currentTrack.lastUpdated = Date.now();
        
        // 只在新歌曲時更新這些內容
        if (isNewTrack) {
            this.log('🎵 新歌曲，更新所有信息');
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
            
            // 使用安全的歌詞載入方法（只調用一次）
            this.safeLyricsLoad();
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
    }

    // 記錄用戶操作（用於動態調整輪詢）
    recordUserAction() {
        this.lastUserAction = Date.now();
        this.log('👆 用戶操作，短暫加速輪詢');
        this.adjustPollingInterval();
    }
    
    // 手動調試方法 - 可在控制台中調用
    debugCurrentTrack() {
        this.log('🛠️ 手動觸發調試檢查...');
        this.log(`📊 當前狀態: sessionId=${this.sessionId?.substring(0, 8)}, isCheckingTrack=${this.isCheckingTrack}, lastCheckTime=${this.lastCheckTime}`);
        this.log(`⏰ 定時器狀態: updateInterval=${!!this.updateInterval}, currentCheckInterval=${this.currentCheckInterval}`);
        this.checkCurrentTrackWithRateLimit();
    }
    
    // 檢查輪詢狀態
    checkPollingStatus() {
        this.log('🔍 輪詢狀態檢查:');
        this.log(`- updateInterval 存在: ${!!this.updateInterval}`);
        this.log(`- currentCheckInterval: ${this.currentCheckInterval}ms`);
        this.log(`- lastCheckTime: ${this.lastCheckTime}`);
        this.log(`- 距離上次檢查: ${Date.now() - this.lastCheckTime}ms`);
        this.log(`- isCheckingTrack: ${this.isCheckingTrack}`);
        this.log(`- sessionId: ${this.sessionId?.substring(0, 8)}...`);
        
        if (!this.updateInterval) {
            this.log('❌ 輪詢定時器未啟動，嘗試重新啟動...');
            this.startTracking();
        }
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
                this.scheduleAutoLogin();
            }
        }, delay);
    }

    updateTrackInfo() {
        if (!this.currentTrack) return;

        this.albumImage.src = this.currentTrack.image || '';
        
        // 根據內容類型調整顯示
        if (this.currentTrack.contentType === 'podcast') {
            this.albumImage.alt = `${this.currentTrack.album} Podcast 封面`;
            this.trackName.textContent = this.currentTrack.name;
            this.artistName.textContent = `🎙️ ${this.currentTrack.artist}`;
            this.albumName.textContent = `Podcast: ${this.currentTrack.album}`;
        } else {
            this.albumImage.alt = `${this.currentTrack.album} 專輯封面`;
            this.trackName.textContent = this.currentTrack.name;
            this.artistName.textContent = this.currentTrack.artist;
            this.albumName.textContent = this.currentTrack.album;
        }
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

        // 從API獲取智慧隨機播放狀態
        if (this.currentTrack.smart_shuffle !== undefined) {
            this.smartShuffle = this.currentTrack.smart_shuffle;
            this.log(`🔀 智慧隨機播放狀態: ${this.smartShuffle ? '開啟' : '關閉'}`);
            this.updateShuffleButton();
        }

        // 檢查是否為單曲播放模式（repeat_state為track）
        if (this.currentTrack.repeat_state === 'track') {
            this.log('🔁 檢測到單曲重複播放模式');
        }

        // 更新播放清單按鈕狀態
        this.updatePlaylistButton();
        
        // 檢查當前歌曲是否在已按讚的歌曲中
        this.checkIfTrackIsLiked();
        
        // 更新手機版歌詞控制區域
        if (this.isMobile && this.currentMobilePage === 'lyrics') {
            this.showMobileLyricsControls();
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

            this.updateLyricsHighlight(elapsedTime + this.lyricsTimeOffset);

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

        // 如果是 Podcast，顯示特殊訊息而不載入歌詞
        if (this.currentTrack.contentType === 'podcast') {
            this.showLyricsPlaceholder('🎙️ 正在播放 Podcast\n\n享受精彩的音頻內容吧！');
            this.updateStatus('lyrics', true);
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
            const proxyUrl = '/api/lyrics/${encodeURIComponent(this.currentTrack.artist)}/${encodeURIComponent(this.currentTrack.name)}';
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
                // 增強的同步歌詞邏輯，添加1.5秒延遲
                const delayedTime = currentTime - 1000; // 延遲1秒
                let bestMatch = -1;
                let minDistance = Infinity;
                
                for (let i = 0; i < this.lyrics.length; i++) {
                    const line = this.lyrics[i];
                    if (!line.time) continue; // 跳過沒有時間戳的行
                    
                    const nextLine = this.lyrics[i + 1];
                    const tolerance = 300; // 增加容錯範圍到300ms
                    
                    // 檢查延遲後的時間是否在這一行的時間範圍內
                    if (line.time <= delayedTime + tolerance) {
                        if (!nextLine || !nextLine.time || nextLine.time > delayedTime + tolerance) {
                            targetIndex = i;
                            break;
                        } else {
                            // 如果在兩行之間，選擇距離更近的
                            const distanceToCurrent = Math.abs(delayedTime - line.time);
                            const distanceToNext = Math.abs(delayedTime - nextLine.time);
                            
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
                        if (line.time && line.time <= delayedTime) {
                            targetIndex = i;
                            break;
                        }
                    }
                }
            } else {
                // 普通歌詞的時間估算邏輯，也添加1.5秒延遲
                if (this.currentTrack && this.currentTrack.duration > 0) {
                    const timeOffset = 500 + 1000; // 原有500ms + 新增1000ms延遲
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
        // 立即更新字體大小，無延遲
        this.lyricsContent.className = `lyrics-content font-${this.fontSize}`;
        
        // 強制重新渲染
        this.lyricsContent.style.fontSize = '';
        this.lyricsContent.offsetHeight; // 觸發重排
        
        // 根據字體大小設置對應的 CSS 類
        const fontSizeMap = {
            'small': '18px',
            'medium': '24px', 
            'large': '30px',
            'extra-large': '36px'
        };
        
        if (fontSizeMap[this.fontSize]) {
            this.lyricsContent.style.fontSize = fontSizeMap[this.fontSize];
        }
    }

    // 歌詞時間偏移調整
    adjustLyricsOffset(offset) {
        this.lyricsTimeOffset += offset;
        this.showOffsetMessage();
        console.log(`歌詞時間偏移: ${this.lyricsTimeOffset}ms`);
    }

    // 重置歌詞時間偏移
    resetLyricsOffset() {
        this.lyricsTimeOffset = 0;
        this.showOffsetMessage();
        console.log('歌詞時間偏移已重置');
    }

    // 顯示偏移調整訊息
    showOffsetMessage() {
        const message = this.lyricsTimeOffset === 0 
            ? '歌詞時間已重置' 
            : `歌詞${this.lyricsTimeOffset > 0 ? '延後' : '提前'} ${Math.abs(this.lyricsTimeOffset/1000)} 秒`;
        
        this.showSuccessMessage(message);
    }

    // 手機頁面切換
    switchMobilePage(page) {
        if (!this.isMobile) return;
        
        this.currentMobilePage = page;
        const musicCard = document.querySelector('.music-card');
        const lyricsContainer = document.querySelector('.lyrics-container');
        const infoBtn = document.getElementById('mobile-info-btn');
        const lyricsBtn = document.getElementById('mobile-lyrics-btn');
        const pageDots = document.querySelectorAll('.page-dot');
        
        if (page === 'info') {
            musicCard.style.display = 'block';
            lyricsContainer.style.display = 'none';
            infoBtn?.classList.add('active');
            lyricsBtn?.classList.remove('active');
            
            // 更新頁面指示器
            pageDots.forEach(dot => {
                if (dot.dataset.page === 'info') {
                    dot.classList.add('active');
                } else {
                    dot.classList.remove('active');
                }
            });
        } else {
            musicCard.style.display = 'none';
            lyricsContainer.style.display = 'block';
            infoBtn?.classList.remove('active');
            lyricsBtn?.classList.add('active');
            
            // 手機版歌詞頁面顯示簡化的播放控制
            this.showMobileLyricsControls();
            
            // 更新頁面指示器
            pageDots.forEach(dot => {
                if (dot.dataset.page === 'lyrics') {
                    dot.classList.add('active');
                } else {
                    dot.classList.remove('active');
                }
            });
        }
    }

    // 顯示手機版歌詞頁面的播放控制
    showMobileLyricsControls() {
        // 檢查是否已經存在手機歌詞控制區域
        let mobileControls = document.getElementById('mobile-lyrics-controls');
        
        if (!mobileControls) {
            // 創建手機版歌詞頁面的播放控制
            mobileControls = document.createElement('div');
            mobileControls.id = 'mobile-lyrics-controls';
            mobileControls.className = 'mobile-lyrics-controls';
            mobileControls.innerHTML = `
                <div class="mobile-track-info">
                    <h3 id="mobile-track-name">-</h3>
                    <p id="mobile-artist-name">-</p>
                </div>
                <div class="mobile-player-controls">
                    <button class="mobile-control-btn" onclick="player.handlePrevious()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                        </svg>
                    </button>
                    <button class="mobile-control-btn mobile-play-pause" onclick="player.handlePlayPause()">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    </button>
                    <button class="mobile-control-btn" onclick="player.handleNext()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                        </svg>
                    </button>
                </div>
            `;
            
            // 插入到歌詞容器的頂部
            const lyricsContainer = document.querySelector('.lyrics-container');
            lyricsContainer.insertBefore(mobileControls, lyricsContainer.firstChild);
        }
        
        // 更新歌曲信息
        if (this.currentTrack) {
            const mobileTrackName = document.getElementById('mobile-track-name');
            const mobileArtistName = document.getElementById('mobile-artist-name');
            
            if (mobileTrackName) mobileTrackName.textContent = this.currentTrack.name || '-';
            if (mobileArtistName) mobileArtistName.textContent = this.currentTrack.artist || '-';
        }
        
        mobileControls.style.display = this.isMobile && this.currentMobilePage === 'lyrics' ? 'block' : 'none';
    }

    // 更新手機布局
    updateMobileLayout() {
        const musicCard = document.querySelector('.music-card');
        const lyricsContainer = document.querySelector('.lyrics-container');
        const mobileNav = document.getElementById('mobile-nav');
        const mobilePageIndicator = document.getElementById('mobile-page-indicator');
        
        if (this.isMobile) {
            // 手機模式：顯示頁面切換按鈕和指示器
            mobileNav.style.display = 'flex';
            mobilePageIndicator.style.display = 'flex';
            this.switchMobilePage(this.currentMobilePage);
            this.bindMobilePageDots();
        } else {
            // 桌面模式：隱藏手機導航並顯示所有內容
            mobileNav.style.display = 'none';
            mobilePageIndicator.style.display = 'none';
            musicCard.style.display = 'block';
            lyricsContainer.style.display = 'block';
            
            // 隱藏手機版歌詞控制
            const mobileControls = document.getElementById('mobile-lyrics-controls');
            if (mobileControls) {
                mobileControls.style.display = 'none';
            }
        }
    }

    // 綁定頁面指示器點擊事件
    bindMobilePageDots() {
        const pageDots = document.querySelectorAll('.page-dot');
        
        pageDots.forEach(dot => {
            dot.addEventListener('click', () => {
                if (!this.isMobile) return;
                
                const targetPage = dot.dataset.page;
                if (targetPage !== this.currentMobilePage) {
                    this.switchMobilePage(targetPage);
                    this.showSwipeIndicator(targetPage === 'info' ? '音樂資訊' : '歌詞頁面');
                }
            });
        });
    }

    // 初始化歌詞控制面板自動隱藏功能
    initLyricsControlsAutoHide() {
        const lyricsControls = document.querySelector('.lyrics-controls');
        if (!lyricsControls) return;

        let hideTimeout;
        let isHovered = false;

        // 鼠標移動到右側邊緣時顯示
        document.addEventListener('mousemove', (e) => {
            const rightEdgeDistance = window.innerWidth - e.clientX;
            
            if (rightEdgeDistance <= 50 && !this.isMobile) {
                this.showLyricsControls();
                this.scheduleHideLyricsControls();
            }
        });

        // 鼠標進入控制面板時保持顯示
        lyricsControls.addEventListener('mouseenter', () => {
            isHovered = true;
            this.showLyricsControls();
            clearTimeout(hideTimeout);
        });

        // 鼠標離開控制面板時延遲隱藏
        lyricsControls.addEventListener('mouseleave', () => {
            isHovered = false;
            this.scheduleHideLyricsControls();
        });

        // 點擊控制按鈕後自動隱藏
        lyricsControls.addEventListener('click', (e) => {
            if (e.target.classList.contains('lyrics-control-btn')) {
                setTimeout(() => {
                    if (!isHovered) {
                        this.hideLyricsControls();
                    }
                }, 1000);
            }
        });
    }

    // 顯示歌詞控制面板
    showLyricsControls() {
        const lyricsControls = document.querySelector('.lyrics-controls');
        if (lyricsControls) {
            lyricsControls.classList.add('show');
        }
    }

    // 隱藏歌詞控制面板
    hideLyricsControls() {
        const lyricsControls = document.querySelector('.lyrics-controls');
        if (lyricsControls) {
            lyricsControls.classList.remove('show');
        }
    }

    // 延遲隱藏歌詞控制面板
    scheduleHideLyricsControls() {
        clearTimeout(this.lyricsControlsHideTimeout);
        this.lyricsControlsHideTimeout = setTimeout(() => {
            this.hideLyricsControls();
        }, 2000); // 2秒後自動隱藏
    }

    // 手機版歌詞控制觸發方法
    initMobileLyricsControlsTrigger() {
        if (this.isMobile) {
            const lyricsControls = document.querySelector('.lyrics-controls');
            if (lyricsControls) {
                // 點擊觸發按鈕顯示/隱藏控制面板
                lyricsControls.addEventListener('click', (e) => {
                    // 使用更簡單的觸發機制 - 點擊右側邊緣35px區域
                    const windowWidth = window.innerWidth;
                    const clickX = e.clientX;
                    
                    // 檢查是否點擊了右側觸發區域
                    if (clickX >= windowWidth - 35) {
                        e.preventDefault();
                        lyricsControls.classList.toggle('mobile-show');
                        
                        // 3秒後自動隱藏
                        setTimeout(() => {
                            lyricsControls.classList.remove('mobile-show');
                        }, 3000);
                    }
                });
                
                // 添加全局觸發按鈕點擊監聽
                document.addEventListener('click', (e) => {
                    const windowWidth = window.innerWidth;
                    const windowHeight = window.innerHeight;
                    const clickX = e.clientX;
                    const clickY = e.clientY;
                    
                    // 檢查是否點擊了圓形觸發按鈕區域 (右側8-56px, 垂直居中±30px)
                    const buttonCenterX = windowWidth - 32; // 按鈕中心X座標
                    const buttonCenterY = windowHeight / 2; // 按鈕中心Y座標
                    const buttonRadius = 30; // 點擊半徑稍微放大
                    
                    const distance = Math.sqrt(
                        Math.pow(clickX - buttonCenterX, 2) + 
                        Math.pow(clickY - buttonCenterY, 2)
                    );
                    
                    if (distance <= buttonRadius) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // 添加點擊動畫效果
                        const trigger = document.querySelector('.lyrics-controls::before');
                        
                        lyricsControls.classList.toggle('mobile-show');
                        
                        // 3秒後自動隱藏
                        setTimeout(() => {
                            lyricsControls.classList.remove('mobile-show');
                        }, 3000);
                    }
                });
                
                // 點擊控制按鈕後隱藏面板
                const controlBtns = lyricsControls.querySelectorAll('.lyrics-control-btn');
                controlBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        setTimeout(() => {
                            lyricsControls.classList.remove('mobile-show');
                        }, 500);
                    });
                });
            }
        }
    }

    // 初始化手機滑動手勢
    initMobileSwipeGestures() {
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        
        const playerSection = document.querySelector('.player-section');
        if (!playerSection) return;

        // 觸摸開始
        playerSection.addEventListener('touchstart', (e) => {
            if (!this.isMobile) return;
            
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
        }, { passive: true });

        // 觸摸結束
        playerSection.addEventListener('touchend', (e) => {
            if (!this.isMobile) return;
            
            const touch = e.changedTouches[0];
            const endX = touch.clientX;
            const endY = touch.clientY;
            const endTime = Date.now();
            
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const deltaTime = endTime - startTime;
            
            // 檢查是否為有效的滑動手勢
            const minSwipeDistance = 80; // 最小滑動距離
            const maxSwipeTime = 500; // 最大滑動時間
            const maxVerticalDistance = 100; // 最大垂直偏移
            
            if (Math.abs(deltaX) > minSwipeDistance && 
                Math.abs(deltaY) < maxVerticalDistance &&
                deltaTime < maxSwipeTime) {
                
                // 左滑：切換到歌詞頁面
                if (deltaX < 0 && this.currentMobilePage === 'info') {
                    this.switchMobilePage('lyrics');
                    this.showSwipeIndicator('歌詞頁面');
                }
                // 右滑：切換到音樂資訊頁面
                else if (deltaX > 0 && this.currentMobilePage === 'lyrics') {
                    this.switchMobilePage('info');
                    this.showSwipeIndicator('音樂資訊');
                }
            }
        }, { passive: true });

        // 添加點擊封面切換功能
        const albumImage = document.getElementById('album-image');
        if (albumImage) {
            albumImage.addEventListener('click', () => {
                if (!this.isMobile) return;
                
                if (this.currentMobilePage === 'info') {
                    this.switchMobilePage('lyrics');
                    this.showSwipeIndicator('歌詞頁面');
                } else {
                    this.switchMobilePage('info');
                    this.showSwipeIndicator('音樂資訊');
                }
            });
        }
    }

    // 顯示滑動指示器
    showSwipeIndicator(message) {
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 500;
            z-index: 2000;
            pointer-events: none;
            backdrop-filter: blur(10px);
            animation: swipeIndicatorAnim 0.6s ease-out;
        `;
        indicator.textContent = message;
        
        // 添加動畫樣式
        if (!document.getElementById('swipe-indicator-style')) {
            const style = document.createElement('style');
            style.id = 'swipe-indicator-style';
            style.textContent = `
                @keyframes swipeIndicatorAnim {
                    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                    50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
                    100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(indicator);
        
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 600);
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
    
    // 增強的 LRC 格式解析函數，更好的錯誤處理
    parseLrcFormat(lrcText) {
        if (!lrcText || typeof lrcText !== 'string') {
            this.log('⚠️ LRC 解析：無效的輸入文本');
            return { isLrc: false, lyrics: [], error: '無效的輸入文本' };
        }
        
        const lines = lrcText.split('\n');
        const lyrics = [];
        let hasTimeStamps = false;
        let parseErrors = 0;
        let successfulParses = 0;
        
        this.log(`📝 開始解析 LRC 格式，共 ${lines.length} 行`);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            
            if (!trimmedLine) {
                continue; // 跳過空行
            }
            
            try {
                // 檢查 LRC 時間戳格式 [mm:ss.xx] 或 [mm:ss]
                const timeMatch = trimmedLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
                
                if (timeMatch) {
                    hasTimeStamps = true;
                    const minutes = parseInt(timeMatch[1]);
                    const seconds = parseInt(timeMatch[2]);
                    const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
                    const text = timeMatch[4].trim();
                    
                    // 驗證時間數據的有效性
                    if (this.isValidTimeData(minutes, seconds, milliseconds)) {
                        const timeMs = (minutes * 60 + seconds) * 1000 + milliseconds;
                        
                        if (text && text.length > 0) {
                            lyrics.push({
                                time: timeMs,
                                text: text,
                                originalLine: line,
                                lineNumber: i + 1
                            });
                            successfulParses++;
                        } else {
                            this.log(`⚠️ LRC 解析：第 ${i + 1} 行時間戳有效但文本為空`);
                            parseErrors++;
                        }
                    } else {
                        this.log(`⚠️ LRC 解析：第 ${i + 1} 行無效的時間數據 [${minutes}:${seconds}.${milliseconds}]`);
                        parseErrors++;
                        // 嘗試作為普通文本處理
                        if (text && text.length > 0) {
                            lyrics.push({
                                text: text,
                                originalLine: line,
                                lineNumber: i + 1
                            });
                        }
                    }
                } else {
                    // 非時間戳行，可能是純文本歌詞或元數據
                    if (!trimmedLine.startsWith('[') || !trimmedLine.includes(']')) {
                        // 檢查是否為有效的歌詞文本
                        if (this.isValidLyricsText(trimmedLine)) {
                            lyrics.push({
                                text: trimmedLine,
                                originalLine: line,
                                lineNumber: i + 1
                            });
                            successfulParses++;
                        } else {
                            this.log(`ℹ️ LRC 解析：第 ${i + 1} 行跳過元數據或無效文本: ${trimmedLine.substring(0, 50)}...`);
                        }
                    } else {
                        // 可能是其他格式的元數據
                        this.log(`ℹ️ LRC 解析：第 ${i + 1} 行跳過元數據標籤: ${trimmedLine.substring(0, 50)}...`);
                    }
                }
            } catch (parseError) {
                this.log(`❌ LRC 解析：第 ${i + 1} 行解析錯誤: ${parseError.message}`);
                parseErrors++;
                
                // 嘗試作為普通文本恢復
                if (trimmedLine.length > 0 && !trimmedLine.startsWith('[')) {
                    lyrics.push({
                        text: trimmedLine,
                        originalLine: line,
                        lineNumber: i + 1,
                        hasError: true
                    });
                    successfulParses++;
                }
            }
        }
        
        // 如果有時間戳，按時間排序
        if (hasTimeStamps && lyrics.length > 0) {
            try {
                lyrics.sort((a, b) => {
                    const timeA = a.time || 0;
                    const timeB = b.time || 0;
                    return timeA - timeB;
                });
                this.log(`✅ LRC 解析完成：${successfulParses} 行成功，${parseErrors} 行錯誤，${hasTimeStamps ? '同步' : '普通'}歌詞`);
            } catch (sortError) {
                this.log(`⚠️ LRC 解析：排序失敗，使用原始順序: ${sortError.message}`);
            }
        }
        
        // 如果沒有成功解析任何行，返回錯誤信息
        if (successfulParses === 0) {
            this.log('❌ LRC 解析：沒有成功解析任何歌詞行');
            return {
                isLrc: false,
                lyrics: [],
                error: '無法解析任何有效的歌詞行',
                parseErrors: parseErrors,
                totalLines: lines.length
            };
        }
        
        // 如果時間戳解析失敗但普通文本成功，降級為普通歌詞
        if (hasTimeStamps && lyrics.filter(line => line.time !== undefined).length === 0) {
            this.log('⚠️ LRC 解析：時間戳解析失敗，降級為普通歌詞');
            hasTimeStamps = false;
            lyrics.forEach(line => delete line.time);
        }
        
        return {
            isLrc: hasTimeStamps,
            lyrics: lyrics,
            parseErrors: parseErrors,
            successfulParses: successfulParses,
            totalLines: lines.length
        };
    }

    // 驗證時間數據的有效性
    isValidTimeData(minutes, seconds, milliseconds) {
        // 檢查是否為有效數字
        if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || 
            (milliseconds !== undefined && !Number.isInteger(milliseconds))) {
            return false;
        }
        
        // 檢查時間範圍是否合理
        if (minutes < 0 || minutes > 99) return false;
        if (seconds < 0 || seconds > 59) return false;
        if (milliseconds !== undefined && (milliseconds < 0 || milliseconds > 999)) return false;
        
        return true;
    }

    // 驗證歌詞文本的有效性
    isValidLyricsText(text) {
        if (!text || typeof text !== 'string') return false;
        if (text.length < 1) return false;
        
        // 排除明顯的元數據標籤
        const metadataPatterns = [
            /^\[.*\]$/g,  // 方括號標籤
            /^[A-Z]+:/g,  // 大寫字母開頭的標籤
            /^\d+$/g,     // 純數字
            /^[\/\[\]\(\)\{\}]+$/g  // 只有符號
        ];
        
        return !metadataPatterns.some(pattern => pattern.test(text));
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
            const response = await fetch('/api/playback/play-pause', {
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
            const response = await fetch('/api/playback/previous', {
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
            const response = await fetch('/api/playback/next', {
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
            const response = await fetch('/api/playback/volume', {
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
            const response = await fetch('/api/playback/volume', {
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
            // 立即更新按鈕狀態以提供即時反饋
            const newState = !this.shuffleState;
            this.shuffleState = newState;
            this.updateShuffleButton();
            
            const response = await fetch('/api/playback/shuffle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('隨機播放切換成功');
                // 減少延遲時間，更快更新狀態
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 500);
            } else {
                console.error('隨機播放切換失敗:', data.error);
                // 如果失敗，恢復原始狀態
                this.shuffleState = !newState;
                this.updateShuffleButton();
            }
        } catch (error) {
            console.error('隨機播放切換請求失敗:', error);
            // 如果失敗，恢復原始狀態
            this.shuffleState = !this.shuffleState;
            this.updateShuffleButton();
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
            // 立即更新按鈕狀態以提供即時反饋
            const repeatModes = ['off', 'context', 'track'];
            const currentIndex = repeatModes.indexOf(this.repeatState);
            const nextIndex = (currentIndex + 1) % repeatModes.length;
            const newState = repeatModes[nextIndex];
            const originalState = this.repeatState;
            
            this.repeatState = newState;
            this.updateRepeatButton();
            
            const response = await fetch('/api/playback/repeat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });
            
            const data = await response.json();
            if (data.success) {
                console.log('重複播放切換成功');
                // 減少延遲時間，更快更新狀態
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 500);
            } else {
                console.error('重複播放切換失敗:', data.error);
                // 如果失敗，恢復原始狀態
                this.repeatState = originalState;
                this.updateRepeatButton();
            }
        } catch (error) {
            console.error('重複播放切換請求失敗:', error);
            // 如果失敗，恢復原始狀態
            const repeatModes = ['off', 'context', 'track'];
            const currentIndex = repeatModes.indexOf(this.repeatState);
            const prevIndex = currentIndex === 0 ? repeatModes.length - 1 : currentIndex - 1;
            this.repeatState = repeatModes[prevIndex];
            this.updateRepeatButton();
        }
    }

    toggleLikedSongs() {
        if (!this.currentTrack || !this.sessionId) return;

        if (this.likedSongsDebounce) {
            clearTimeout(this.likedSongsDebounce);
        }
        
        this.likedSongsDebounce = setTimeout(() => {
            this.sendToggleLikedRequest();
        }, 200);
    }

    async sendToggleLikedRequest() {
        try {
            // 首先檢查當前狀態
            const checkResponse = await fetch('/api/library/check/${this.currentTrack.id}', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (!checkResponse.ok) {
                throw new Error('無法檢查歌曲狀態');
            }
            
            const checkData = await checkResponse.json();
            const isCurrentlyLiked = checkData.isLiked;
            
            // 根據當前狀態決定操作
            const endpoint = isCurrentlyLiked ? '/api/library/remove' : '/api/library/add';
            const method = 'POST'; // 兩個 API 都使用 POST 方法
            const action = isCurrentlyLiked ? '移除' : '添加';
            
            // 立即更新 UI 以提供即時反饋
            this.updateLikeButtonState(!isCurrentlyLiked);
            
            const response = await fetch('${endpoint}', {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ trackId: this.currentTrack.id })
            });
            
            const data = await response.json();
            if (data.success) {
                const message = isCurrentlyLiked ? '💔 已從喜歡的歌曲移除' : '❤️ 已添加到喜歡的歌曲';
                console.log(`${action}喜歡的歌曲成功`);
                this.showSuccessMessage(message);
                
                // 確認最終狀態
                setTimeout(() => {
                    this.checkIfTrackIsLiked();
                }, 500);
            } else {
                console.error(`${action}喜歡的歌曲失敗:`, data.error);
                this.showErrorMessage(`${action}失敗: ` + (data.error || '未知錯誤'));
                
                // 恢復原始狀態
                this.updateLikeButtonState(isCurrentlyLiked);
            }
        } catch (error) {
            console.error('切換喜歡狀態請求失敗:', error);
            this.showErrorMessage('網絡錯誤，請重試');
            
            // 重新檢查狀態以確保 UI 正確
            setTimeout(() => {
                this.checkIfTrackIsLiked();
            }, 1000);
        }
    }

    // 保留舊方法以向後兼容
    addToLikedSongs() {
        this.toggleLikedSongs();
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

            const response = await fetch('/api/player/queue', { headers });
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
            const response = await fetch('/api/extract-colors', {
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

            const response = await fetch('/api/player/queue', { headers });
            
            if (response.status === 401) {
                console.log('🔑 Queue 認證問題，靜默處理...');
                const authFixed = await this.handleAuthError();
                if (authFixed) {
                    this.playlistContent.innerHTML = '<div class="loading">認證已修復，請重新打開播放清單</div>';
                } else {
                    this.playlistContent.innerHTML = '<div class="loading">認證失敗，請重新登入</div>';
                }
                return;
            }
            
            if (response.ok) {
                const data = await response.json();
                if (data.queue && data.queue.length > 0) {
                    this.displayPlaylist(data.queue);
                } else {
                    this.playlistContent.innerHTML = '<div class="loading">播放清單為空</div>';
                }
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('載入播放清單失敗:', response.status, errorData);
                this.playlistContent.innerHTML = `<div class="loading">無法載入播放清單 (${response.status})</div>`;
            }
        } catch (error) {
            console.error('載入播放清單失敗:', error);
            this.playlistContent.innerHTML = '<div class="loading">網絡錯誤，請重試</div>';
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
                if (trackId && trackId !== 'undefined') {
                    this.playTrack(trackId);
                } else {
                    this.showErrorMessage('無法播放此歌曲：歌曲ID無效');
                }
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

            const response = await fetch('/api/devices', { headers });
            
            if (response.status === 401) {
                console.log('🔑 Devices 認證問題，靜默處理...');
                const authFixed = await this.handleAuthError();
                if (authFixed) {
                    this.devicesContent.innerHTML = '<div class="loading">認證已修復，請重新打開設備清單</div>';
                } else {
                    this.devicesContent.innerHTML = '<div class="loading">認證失敗，請重新登入</div>';
                }
                return;
            }
            
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

            const response = await fetch('/api/player/transfer', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ device_ids: [deviceId], play: true })
            });
            
            if (response.status === 401) {
                console.log('🔑 Transfer 認證問題，嘗試修復...');
                const authFixed = await this.handleAuthError();
                if (authFixed) {
                    // 重新嘗試請求
                    const retryResponse = await fetch('/api/player/transfer', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Session-Id': this.sessionId
                        },
                        body: JSON.stringify({ device_ids: [deviceId], play: true })
                    });
                    if (retryResponse.ok) {
                        this.devicesModal.style.display = 'none';
                        this.showSuccessMessage('✅ 已切換播放設備');
                        setTimeout(() => this.checkCurrentTrackWithRateLimit(), 2000);
                        return;
                    }
                }
                this.showErrorMessage('設備切換認證失敗');
                return;
            }

            if (response.ok) {
                this.devicesModal.style.display = 'none';
                this.showSuccessMessage('✅ 已切換播放設備');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 2000);
            } else {
                const data = await response.json().catch(() => ({}));
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

        this.log(`🎵 嘗試播放歌曲: ${trackId}`);

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const playUrl = '/api/play';
            this.log(`📡 播放請求 URL: ${playUrl}`);

            const response = await fetch(playUrl, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
            });

            this.log(`📡 播放響應狀態: ${response.status}`);

            if (response.status === 404) {
                this.log('❌ 播放端點不存在 (404)');
                this.showErrorMessage('播放功能暫時無法使用，請檢查服務端配置');
                return;
            }

            if (response.status === 401) {
                this.log('🔑 播放認證問題，嘗試修復...');
                const authFixed = await this.handleAuthError();
                if (authFixed) {
                    // 重新嘗試播放
                    const retryResponse = await fetch(playUrl, {
                        method: 'PUT',
                        headers: { 
                            'Content-Type': 'application/json',
                            'X-Session-Id': this.sessionId 
                        },
                        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
                    });
                    
                    if (retryResponse.ok) {
                        this.log('✅ 重試播放成功');
                        this.playlistModal.style.display = 'none';
                        this.showSuccessMessage('🎵 開始播放歌曲');
                        setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
                        return;
                    } else {
                        this.log(`❌ 重試播放失敗: ${retryResponse.status}`);
                    }
                }
                this.showErrorMessage('播放認證失敗，請重新登入');
                return;
            }

            if (response.ok) {
                this.log('✅ 播放請求成功');
                this.playlistModal.style.display = 'none';
                this.showSuccessMessage('🎵 開始播放歌曲');
                setTimeout(() => this.checkCurrentTrackWithRateLimit(), 1000);
            } else {
                const errorData = await response.json().catch(() => ({}));
                this.log(`❌ 播放失敗: ${response.status} - ${errorData.error || response.statusText}`);
                this.showErrorMessage(`播放失敗: ${errorData.error || `HTTP ${response.status}`}`);
            }
        } catch (error) {
            this.log(`❌ 播放請求異常: ${error.message}`);
            this.showErrorMessage('播放請求失敗，請檢查網絡連接');
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
            
            // 根據不同狀態顯示不同的SVG圖示
            if (isSmartShuffle) {
                this.shuffleBtn.title = '智慧隨機播放';
                this.shuffleBtn.style.setProperty('background', 'linear-gradient(135deg, #1db954, #1ed760)', 'important');
                this.shuffleBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14.83 13.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04L14.83 13.41zM14.5 4l2.04 2.04L13.41 9.17l1.41 1.41 3.13-3.13L20 9.5V4H14.5z"/>
                        <path d="M8.5 12.5l4.5-4.5L8.5 3.5 4 8l4.5 4.5z"/>
                        <circle cx="19" cy="5" r="2" fill="#1db954"/>
                        <circle cx="19" cy="19" r="2" fill="#1db954"/>
                    </svg>`;
            } else if (isRegularShuffle) {
                this.shuffleBtn.title = '隨機播放';
                this.shuffleBtn.style.removeProperty('background');
                this.shuffleBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14.83 13.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04L14.83 13.41zM14.5 4l2.04 2.04L13.41 9.17l1.41 1.41 3.13-3.13L20 9.5V4H14.5zM10.59 9.17l-2.08-2.08C7.95 6.53 7.25 6.17 6.54 6.17H4v2h2.54L10.59 9.17zM4 15.83V18h2.54c.71 0 1.41-.35 1.97-.92L10.59 14.83 9.17 13.41 4 15.83z"/>
                    </svg>`;
            } else {
                this.shuffleBtn.title = '開啟隨機播放';
                this.shuffleBtn.style.removeProperty('background');
                this.shuffleBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.6">
                        <path d="M14.83 13.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04L14.83 13.41zM14.5 4l2.04 2.04L13.41 9.17l1.41 1.41 3.13-3.13L20 9.5V4H14.5zM10.59 9.17l-2.08-2.08C7.95 6.53 7.25 6.17 6.54 6.17H4v2h2.54L10.59 9.17zM4 15.83V18h2.54c.71 0 1.41-.35 1.97-.92L10.59 14.83 9.17 13.41 4 15.83z"/>
                    </svg>`;
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
                'track': '單曲重複播放'
            };

            this.repeatBtn.title = titles[this.repeatState] || '重複播放';
            
            // 根據不同狀態顯示不同的SVG圖示
            if (this.repeatState === 'track') {
                // 單曲重複播放圖示
                this.repeatBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                        <text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">1</text>
                    </svg>`;
            } else if (this.repeatState === 'context') {
                // 重複播放清單圖示
                this.repeatBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                    </svg>`;
            } else {
                // 關閉重複播放圖示（灰色）
                this.repeatBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.6">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                    </svg>`;
            }
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

    updatePlaylistButton() {
        if (!this.playlistBtn || !this.currentTrack) return;
        
        // 檢查當前歌曲是否在播放清單中
        const isInQueue = this.currentTrack.queue && 
                         this.currentTrack.queue.some(track => track.id === this.currentTrack.id);
        
        this.playlistBtn.classList.toggle('active', isInQueue);
        
        if (isInQueue) {
            this.playlistBtn.title = '當前歌曲在播放清單中';
        } else {
            this.playlistBtn.title = '查看播放清單';
        }
    }

    async checkIfTrackIsLiked() {
        if (!this.addToPlaylistBtn || !this.currentTrack || !this.sessionId) return;
        
        // 添加延遲，避免與其他 API 調用衝突
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
            const response = await fetch('/api/library/check/${this.currentTrack.id}', {
                headers: {
                    'X-Session-Id': this.sessionId
                }
            });
            
            if (response.status === 401) {
                this.log('🔑 Library check 認證問題，嘗試修復...');
                this.scheduleAutoLogin();
                const authFixed = await this.handleAuthError();
                if (authFixed) {
                    // 重新嘗試請求
                    const retryResponse = await fetch('/api/library/check/${this.currentTrack.id}', {
                        headers: {
                            'X-Session-Id': this.sessionId
                        }
                    });
                    if (retryResponse.ok) {
                        const retryData = await retryResponse.json();
                        // 直接更新按讚狀態
                        this.updateLikeButtonState(retryData.isLiked);
                    } else if (retryResponse.status === 401) {
                        this.log('❌ Library check 重試後仍然 401，停止檢查');
                        return;
                    }
                } else {
                    this.log('❌ Library check 認證修復失敗');
                }
                return;
            }
            
            if (response.ok) {
                const data = await response.json();
                this.updateLikeButtonState(data.isLiked);
            }
        } catch (error) {
            this.log(`❌ 檢查歌曲是否已按讚失敗: ${error.message}`);
            // 如果是網路錯誤，不要顯示錯誤，靜默失敗
            if (error.name !== 'TypeError') {
                this.log('🔇 Library check 靜默失敗，不影響主要功能');
            }
        }
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

// 防止重複實例化
let playerInstance = null;

// 初始化應用程式
document.addEventListener('DOMContentLoaded', () => {
    if (!playerInstance) {
        playerInstance = new SpotifyLyricsPlayer();
        window.spotifyPlayer = playerInstance;
        
        // 暴露調試方法
        window.debugCurrentTrack = () => playerInstance.debugCurrentTrack();
        window.checkPollingStatus = () => playerInstance.checkPollingStatus();
        
        console.log('✅ Spotify 播放器已初始化');
        console.log('🛠️ 調試方法已暴露: debugCurrentTrack(), checkPollingStatus()');
    }
});

// 處理頁面可見性變化
document.addEventListener('visibilitychange', () => {
    if (!playerInstance) return;
    
    if (document.hidden) {
        // 頁面隱藏時減少更新頻率
        if (playerInstance.updateInterval) {
            clearInterval(playerInstance.updateInterval);
            playerInstance.updateInterval = setInterval(() => {
                playerInstance.checkCurrentTrackWithRateLimit();
            }, 60000); // 60秒更新一次
        }
    } else {
        // 頁面顯示時恢復正常頻率
        console.log('📱 頁面可見，恢復正常輪詢');
        if (playerInstance.updateInterval) {
            clearInterval(playerInstance.updateInterval);
            playerInstance.updateInterval = setInterval(() => {
                playerInstance.checkCurrentTrackWithRateLimit();
            }, playerInstance.currentCheckInterval);
        }
        // 立即執行一次檢查
        playerInstance.checkCurrentTrackWithRateLimit();
    }
});

async function spotifyRequest(url, options = {}) {
    const player = window.spotifyPlayer;
    if (!player) return Promise.reject(new Error('播放器尚未初始化'));

    const headers = options.headers || {};
    if (player.sessionId) {
        headers['X-Session-Id'] = player.sessionId;
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        console.warn('🔑 認證失敗，觸發自動登入...');
        player.scheduleAutoLogin();
        this.scheduleAutoLogin();
        return Promise.reject(new Error('認證失敗，已觸發自動登入'));
    }

    return response;
}

// 頁面卸載時清理
window.addEventListener('beforeunload', () => {
    if (playerInstance) {
        playerInstance.stopTracking();
        console.log('🧹 播放器已清理');
    }
});
