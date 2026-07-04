// public/script.js
class SpotifyLyricsPlayer {
    constructor() {
        // 日誌輔助函數 - 必須放在最前面
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

        this.currentTrack = null;
        this.lyrics = [];
        this.lyricsType = 'plain';
        this.currentLyricIndex = 0;
        this._lastScrolledIndex = -1; // 追蹤上次滾動的歌詞索引，防止重複滾動
        this._scrollTimeout = null; // 滾動防抖定時器
        this.autoScroll = true;
        this.fontSize = 'medium';
        this.updateInterval = null;
        this.lyricsUpdateTimeout = null;
        this.animationFrameId = null;
        this.progressClockTimer = null;
        this.sessionId = null;
        this.nextTrackPreviewTimeout = null;
        this.currentLyricsTrackId = null;
        this.isLoadingLyrics = false;
        this.isLyricsOverridden = false;
        this.lastExtractedImageUrl = null;
        this.lastLyricsRequest = null; // 記錄最後一次歌詞請求
        this.lyricsLoadTimeout = null; // 歌詞載入超時控制
        
        // 添加 API 速率限制控制
        this.isCheckingTrack = false;
        this.lastCheckTime = 0;
        this.baseCheckInterval = 10000; // 基礎檢查間隔10秒
        this.currentCheckInterval = 10000; // 當前檢查間隔
        this.retryCount = 0;
        this.maxRetries = 3;
        this.backoffDelay = 5000; // 增加退避延遲到5秒
        
        // Spotify timestamp sync for accurate timing
        this.spotifyProgress = 0;
        this.spotifyTimestamp = 0;
        
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
        this.isRefreshing = false; // 防止重複刷新頁面
        this.lastRefreshTime = 0; // 上次刷新時間
        
        // 自動登入控制
        this.autoLoginInterval = null;
        this.autoLoginEnabled = true;
        
        // 增強的 Session 管理器
        this.sessionManager = null;
        
        // Podcast 檢測相關
        this.currentContentType = 'music'; // 'music' 或 'podcast'
        
        // 歌詞時間偏移控制
        this.lyricsTimeOffset = 0; // 毫秒，正數代表歌詞提前顯示，負數代表歌詞延後顯示
        
        // 歌詞緩存控制
        this.lyricsCache = new Map(); // 內存中的歌詞緩存
        this.authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('spotify_auth') : null;
        if (this.authChannel) {
            this.authChannel.onmessage = (ev) => {
                const d = ev.data || {};
                if (d.type === 'session-update' && d.sessionId && d.sessionId !== this.sessionId) {
                    this.sessionId = d.sessionId;
                    localStorage.setItem('spotify_session_id', this.sessionId);
                    this.log(`🔄 接收分頁會話: ${this.sessionId.substring(0, 8)}...`);
                }
            };
        }
        this.lyricsCacheExpiry = 24 * 60 * 60 * 1000; // 24小時過期時間
        
        // 歌詞時間調整保存控制
        this.lyricsTimeAdjustments = new Map(); // 保存歌詞時間調整
        this.savedLyrics = new Map(); // 保存的歌詞 (優先載入)
        this.initSavedLyricsAndAdjustments(); // 初始化保存的歌詞和時間調整
        
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
        
        // 下一首歌詞預加載相關
        this.nextSongLyrics = null; // 預加載的下一首歌詞
        this.nextSongLyricsType = null; // 下一首歌詞類型
        this.isPreloadingNextLyrics = false; // 是否正在預加載下一首歌詞
        this.nextLyricsPreloadTimeout = null; // 預加載定時器
        this.lastPreloadedTrackId = null; // 上次預加載的歌曲 ID
        this.lyricsSearchFailedFor = new Set(); // 記錄加載失敗的歌曲


        
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
        this.log('🌐 环境检测: ' + JSON.stringify({
            hostname: window.location.hostname,
            isLocal: this.isLocal,
            isVercel: this.isVercel,
            isLiveWmcc: this.isLiveWmcc,
            apiBase: this.apiBase,
            fullApiUrl: window.location.origin + this.apiBase,
            playEndpoint: window.location.origin + this.apiBase + '/api/play'
        }));
        
        this.initializeElements();
        this.bindEvents();
        this.handleAuthCallback();
        this.checkAuthStatus();
        this.startAutoLoginTimer();
        
        // 初始化偏移顯示
        this.updateOffsetDisplay();
        
        // 初始化手機布局
        this.updateMobileLayout();
        
        // 設置全局播放器引用供手機控制使用
        window.player = this;
        
        // 设置全局动态背景引用
        // 动态背景系统已移除
        
        // 頁面載入完成後安排自動登入 - 增加延迟确保DOM就绪
        setTimeout(() => {
            this.scheduleAutoLogin();
        }, 1000);
        
        // 启动定期的静默session检查（每3分钟，更频繁）
        this.startPeriodicSessionCheck();
        
        // 初始化歌詞緩存
        this.initLyricsCache();
        
        // 初始化控制頻道
        this.controlChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('spotify_control') : null;
        if (this.controlChannel) {
            this.controlChannel.onmessage = (ev) => {
                const d = ev.data || {};
                if (d.type === 'control-sync') {
                    const isReset = d.lyricsOffset !== undefined && d.manualLyrics !== undefined;

                    if (isReset) {
                        this.log(`🔄 接收重置設定（來自其他分頁）`);
                        this.lyricsTimeOffset = d.lyricsOffset;
                        this.updateOffsetDisplay();
                        if (this.currentTrack && this.lyrics.length > 0) {
                            this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
                        }
                        this.checkCurrentTrackWithRateLimit();
                        this.showRemoteControlToast('其他分頁已重置所有歌詞設定');
                    } else {
                        if (d.lyricsOffset !== undefined) {
                            this.log(`🔄 接收控制偏移: ${d.lyricsOffset}ms`);
                            this.lyricsTimeOffset = d.lyricsOffset;
                            this.updateOffsetDisplay();
                            // 🔧 修正：使用即時進度 + 偏移量，而非只傳入靜態 progress 快照
                            if (this.currentTrack && this.lyrics.length > 0) {
                                this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
                            }
                            this.showRemoteControlToast(this.formatOffsetToastMessage(d.lyricsOffset));
                        }
                        if (d.manualLyrics !== undefined) {
                            this.log(`🔄 接收手動歌詞更新`);
                            this.checkCurrentTrackWithRateLimit(); // 強制重新檢查以加載新歌詞
                            this.showRemoteControlToast(this.formatManualLyricsToastMessage(d.manualLyrics));
                        }
                    }
                } else if (d.type === 'seek-sync' && d.position_ms !== undefined) {
                    // 🔧 修正：原本這幾個分支被誤放在 control-sync 判斷式裡面，
                    // d.type 不可能同時是 'control-sync' 又是 'seek-sync'，導致這裡永遠執行不到
                    this.log(`🔄 接收跳轉請求: ${d.position_ms}ms`);
                    if (this.currentTrack) {
                        this.currentTrack.progress = d.position_ms;
                        this.currentTrack.lastUpdated = Date.now();
                        this.lastCheckTime = d.timestamp || Date.now();
                        this.updateLyricsHighlight(d.position_ms + this.lyricsTimeOffset);
                        this.updateProgress();
                    }
                } else if (d.type === 'playback-sync' && d.isPlaying !== undefined) {
                    this.log(`🔄 接收播放狀態更新: ${d.isPlaying ? '播放' : '暫停'}`);
                    if (this.currentTrack) {
                        this.currentTrack.isPlaying = d.isPlaying;
                        if (d.lastProgress !== undefined) this.currentTrack.progress = d.lastProgress;
                        this.currentTrack.lastUpdated = Date.now();
                        this.lastCheckTime = d.timestamp || Date.now();
                        this.updateProgress();
                    }
                } else if (d.type === 'lyrics-sync' && d.lyrics) {
                    this.log(`🔄 接收歌詞數據同步: ${d.lyrics.length} 行`);
                    if (this.currentTrack && d.trackId === this.currentTrack.id) {
                        this.lyrics = d.lyrics;
                        this.lyricsType = d.lyricsType || 'plain';
                        this.currentLyricIndex = 0;
                        this.isLyricsOverridden = true;
                        // 立即更新顯示
                        this.displayLyrics();
                        this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
                    }
                }
            };
        }

        // 初始化自動同步功能
        this.initAutoSync();

        // 即時統計初始化
        this.initLiveStats();

        // 初始化增強 Session 管理器
        this.initSessionManager();

        // 初始化同步控制按鈕
        this.initSyncControls();

        // 在初始化完成後，立即從雲端同步數據以確保一致性
        setTimeout(() => {
            if (this.sessionId) {
                this.syncWithCloudOnLoad();
                // Connect SSE for real-time cross-device sync
                this.connectSSEForSync();
            }
        }, 2000); // 延遲2秒以確保其他初始化完成
    }

    // Connect SSE for real-time cross-device settings sync
    connectSSEForSync() {
        if (!window.spotifyManager) return;
        
        window.spotifyManager.onSettingsChanged = (version) => {
            this.log(`📡 SSE: 設定已變更 (v${version})，立即同步...`);
            this.checkCurrentTrack(); // Bypass rate limit
        };

        window.spotifyManager.onSyncEvent = (event) => {
            this.log(`📡 SSE: 收到即時同步事件:`, event);
            this.applySyncEvent(event);
        };
        
        window.spotifyManager.connectSSE();
        this.log('📡 SSE 連接已啟動');
    }

    getCurrentProgress() {
        if (!this.currentTrack) return 0;
        if (this.currentTrack.isPlaying && this.currentTrack.lastUpdated) {
            const elapsed = (Date.now() - this.currentTrack.lastUpdated) + this.currentTrack.progress;
            return Math.min(this.currentTrack.duration, elapsed);
        }
        return this.currentTrack.progress || 0;
    }

    applySyncEvent(d) {
        if (!d) return;
        
        if (d.type === 'control-sync') {
            const isFromOtherDevice = d.senderSessionId && this.sessionId && d.senderSessionId !== this.sessionId;
            const isReset = d.lyricsOffset !== undefined && d.manualLyrics !== undefined;

            if (isReset) {
                this.log(`🔄 應用重置設定（來自其他裝置的控制指令）`);
                this.lyricsTimeOffset = d.lyricsOffset;
                this.updateOffsetDisplay();
                if (this.currentTrack && this.lyrics.length > 0) {
                    this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
                }
                this.checkCurrentTrack();
                if (isFromOtherDevice) this.showRemoteControlToast('其他裝置已重置所有歌詞設定');
            } else {
                if (d.lyricsOffset !== undefined) {
                    this.log(`🔄 應用控制偏移: ${d.lyricsOffset}ms`);
                    this.lyricsTimeOffset = d.lyricsOffset;
                    this.updateOffsetDisplay();
                    if (this.currentTrack && this.lyrics.length > 0) {
                        this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
                    }
                    if (isFromOtherDevice) this.showRemoteControlToast(this.formatOffsetToastMessage(d.lyricsOffset));
                }
                if (d.manualLyrics !== undefined) {
                    this.log(`🔄 應用手動歌詞更新`);
                    this.checkCurrentTrack(); // 繞過限制，立即載入
                    if (isFromOtherDevice) this.showRemoteControlToast(this.formatManualLyricsToastMessage(d.manualLyrics));
                }
            }
        }
        if (d.type === 'seek-sync' && d.position_ms !== undefined) {
            this.log(`🔄 應用跳轉請求: ${d.position_ms}ms`);
            if (this.currentTrack) {
                this.currentTrack.progress = d.position_ms;
                this.currentTrack.lastUpdated = Date.now();
                this.lastCheckTime = d.timestamp || Date.now();
                this.updateLyricsHighlight(d.position_ms + this.lyricsTimeOffset);
                this.updateProgress();
            }
        }
        if (d.type === 'playback-sync' && d.isPlaying !== undefined) {
            this.log(`🔄 應用播放狀態更新: ${d.isPlaying ? '播放' : '暫停'}`);
            if (this.currentTrack) {
                this.currentTrack.isPlaying = d.isPlaying;
                if (d.lastProgress !== undefined) this.currentTrack.progress = d.lastProgress;
                this.currentTrack.lastUpdated = Date.now();
                this.lastCheckTime = d.timestamp || Date.now();
                this.updateProgress();
            }
        }
        if (d.type === 'lyrics-sync' && d.lyrics) {
            this.log(`🔄 應用歌詞數據同步: ${d.lyrics.length} 行`);
            if (this.currentTrack && d.trackId === this.currentTrack.id) {
                this.lyrics = d.lyrics;
                this.lyricsType = d.lyricsType || 'plain';
                this.currentLyricIndex = 0;
                this.isLyricsOverridden = true;
                this.displayLyrics();
                this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
            }
        }
        if (d.type === 'raw-lyrics-sync' && d.lyrics) {
            this.log(`🔄 應用原始歌詞數據同步`);
            if (this.currentTrack && d.trackId === this.currentTrack.id) {
                const parsed = this.parseLrcFormat(d.lyrics);
                if (parsed && parsed.lyrics) {
                    this.lyrics = parsed.lyrics;
                    this.lyricsType = d.lyricsType || (parsed.isLrc ? 'synced' : 'plain');
                    this.currentLyricIndex = 0;
                    this.isLyricsOverridden = true;
                    this.overriddenLyricsSource = d.source || 'manual';
                    this.displayLyrics();
                    this.updateLyricsHighlight(this.getCurrentProgress() + this.lyricsTimeOffset);
                }
            }
        }
        if (d.type === 'force-refresh-sync') {
            this.log(`🔄 應用強制刷新請求`);
            this.checkCurrentTrack();
        }
    }

    // 在加載時從雲端同步數據以確保跨瀏覽器一致性
    async syncWithCloudOnLoad() {
        try {
            this.log('🔄 應用程序加載時同步雲端數據...');

            // 從雲端獲取最新數據
            const downloadResponse = await fetch('/api/kv/get-all-lyrics', {
                headers: { 'X-Session-Id': this.sessionId }
            });

            if (downloadResponse.ok) {
                const data = await downloadResponse.json();
                if (data.success && Array.isArray(data.lyrics)) {
                    // 從 localStorage 獲取當前本地數據
                    const currentLocalLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
                    let localLyricsUpdated = false;

                    this.log(`📥 開始從雲端同步 ${data.lyrics.length} 條歌詞...`);

                    for (const lyricData of data.lyrics) {
                        // 驗證數據完整性
                        if (!lyricData.trackInfo || !lyricData.trackInfo.id) {
                            this.log(`⚠️ 跳過無效雲端歌詞數據: 缺少 trackInfo 或 trackInfo.id`);
                            continue;
                        }

                        const cacheKey = this.generateTrackCacheKey(lyricData.trackInfo);

                        // 檢查是否本地已經有這個歌詞（比較時間戳來判斷哪個更新）
                        const localLyric = currentLocalLyrics[cacheKey];
                        const cloudTimestamp = lyricData.lastModified || lyricData.updatedAt || lyricData.lastUsed || Date.now();
                        const localTimestamp = localLyric?.lastUsed || 0;

                        // 如果雲端數據更新，或者本地沒有此歌詞，則下載
                        if (!localLyric || cloudTimestamp > localTimestamp) {
                            // 添加到內存中的 savedLyrics
                            this.savedLyrics.set(cacheKey, lyricData);

                            // 同時添加到 localStorage（更新時間戳）
                            currentLocalLyrics[cacheKey] = {
                                trackInfo: lyricData.trackInfo,
                                lyrics: lyricData.lyricsContent || lyricData.lyrics,
                                lyricsType: lyricData.lyricsType || 'synced',
                                source: lyricData.source || { source: 'cloud' },
                                lastUsed: Date.now()
                            };
                            localLyricsUpdated = true;
                        }
                    }

                    // 如果本地數據有更新，保存到 localStorage
                    if (localLyricsUpdated) {
                        localStorage.setItem('user_custom_lyrics', JSON.stringify(currentLocalLyrics));
                        this.log(`📥 已從雲端同步 ${Object.keys(currentLocalLyrics).length} 條歌詞到本地`);

                        // 更新本地歌詞計數顯示
                        if (typeof this.updateSyncStatus === 'function') {
                            this.updateSyncStatus();
                        }
                    } else {
                        this.log(`✅ 本地歌詞已是最新，無需更新`);
                    }
                } else {
                    this.log(`⚠️ 雲端返回空數據或格式錯誤`);
                }
            } else {
                this.log(`⚠️ 無法從雲端獲取歌詞數據: ${downloadResponse.status}`);
            }

            this.log('✅ 雲端數據同步完成');
        } catch (error) {
            this.log(`❌ 雲端數據同步失敗: ${error.message}`);
        }
    }

    // 初始化歌詞緩存
    initLyricsCache() {
        try {
            const cached = localStorage.getItem('lyrics_cache');
            if (cached) {
                const cacheData = JSON.parse(cached);
                // 清理過期的緩存項目
                const now = Date.now();
                for (const [key, value] of Object.entries(cacheData)) {
                    if (now - value.timestamp < this.lyricsCacheExpiry) {
                        this.lyricsCache.set(key, value);
                    }
                }
                this.log(`📚 已載入 ${this.lyricsCache.size} 個緩存的歌詞`);
            }
        } catch (error) {
            this.log(`❌ 載入歌詞緩存失敗: ${error.message}`);
            localStorage.removeItem('lyrics_cache');
        }
    }

    // 初始化自動同步功能
    initAutoSync() {
        // 從 localStorage 讀取同步間隔設定，預設為 5 分鐘
        this.autoSyncInterval = parseInt(localStorage.getItem('auto_sync_interval')) || 300000; // 5分鐘
        
        // ✨ 核心修復：正確讀取布爾值，確保狀態持久化
        const storedEnabled = localStorage.getItem('auto_sync_enabled');
        this.autoSyncEnabled = storedEnabled === null ? true : storedEnabled === 'true';
        this.lastSyncTime = parseInt(localStorage.getItem('last_sync_time')) || 0;
        
        this.log(`🔄 自動同步設定 - 間隔: ${this.autoSyncInterval/1000}秒, 啟用: ${this.autoSyncEnabled}`);
        
        // ✨ 核心修復：同步 UI 狀態
        const toggleBtn = document.getElementById('auto-sync-toggle');
        if (toggleBtn) {
            toggleBtn.checked = this.autoSyncEnabled;
        }

        if (this.autoSyncEnabled) {
            this.startAutoSync();
        }
    }
    
    // 初始化增強 Session 管理器
    initSessionManager() {
        try {
            if (typeof EnhancedSessionManager !== 'undefined') {
                this.sessionManager = new EnhancedSessionManager(this);
                this.log('✅ 增強 Session 管理器已啟動');
            } else {
                this.log('⚠️ EnhancedSessionManager 未載入，使用基礎 session 管理');
            }
        } catch (error) {
            this.log(`❌ 初始化 Session 管理器失敗: ${error.message}`);
        }
    }

    // 開始自動同步
    startAutoSync() {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
        }
        
        // 立即執行一次同步
        setTimeout(() => this.performAutoSync(), 3000); // 延遲3秒避免初始化衝突
        
        // 設定定期同步
        this.autoSyncTimer = setInterval(() => {
            this.performAutoSync();
        }, this.autoSyncInterval);
        
        this.log(`✅ 自動同步已啟動，間隔: ${this.autoSyncInterval/1000}秒`);
    }

    // 停止自動同步
    stopAutoSync() {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
        this.log('⏹️ 自動同步已停止');
    }

    // 執行自動同步
    async performAutoSync() {
        if (!this.sessionId || !this.autoSyncEnabled) {
            this.log('⏭️ 跳過自動同步 - 無session或已停用');
            return;
        }

        this.log('🔄 開始自動背景同步...');
        
        try {
            // 使用新的一鍵同步功能 (靜默背景執行)
            if (typeof this.syncAndMergeAllData === 'function') {
                await this.syncAndMergeAllData(true);
            } else {
                // 如果函數尚未載入，則跳過
                this.log('⚠️ syncAndMergeAllData 尚未準備就緒');
            }
            
            // 更新最後同步時間
            this.lastSyncTime = Date.now();
            localStorage.setItem('last_sync_time', this.lastSyncTime.toString());
            
        } catch (error) {
            this.log(`❌ 自動同步失敗: ${error.message}`);
        }
    }

    // 同步歌詞數據 (已併入 syncAndMergeAllData)
    async syncLyricsData() { return 0; }

    // 同步時間調整數據 (已併入 syncAndMergeAllData)
    async syncTimeAdjustments() {
    try {
        let newOffsetsCount = 0;

        /* =========================
         * 1️⃣ 從雲端下載時間調整
         * ========================= */
        const downloadResponse = await fetch('/api/kv/get-time-offsets', {
            headers: {
                'X-Session-Id': this.sessionId
            }
        });

        if (!downloadResponse.ok) {
            this.log(`⚠️ 無法從雲端獲取時間調整數據: ${downloadResponse.status}`);
            return;
        }

        const cloudResult = await downloadResponse.json();
        const cloudData = Array.isArray(cloudResult)
            ? cloudResult
            : (cloudResult.data || Object.values(cloudResult.offsets || {}));
        const localOffsets =
            JSON.parse(localStorage.getItem('lyrics_time_adjustments') || '{}');

        for (const lyricData of cloudData || []) {
            const trackId = lyricData?.trackInfo?.id;
            if (!trackId) continue;

            const existingAdjustment = localOffsets[trackId];

            const cloudTimestamp = lyricData.lastUpdated || 0;
            const localTimestamp = existingAdjustment?.lastUpdated || 0;

            // 雲端較新 or 本地沒有
            if (!existingAdjustment || cloudTimestamp > localTimestamp) {
                const timeOffset =
                    lyricData.timeOffset !== undefined
                        ? lyricData.timeOffset
                        : lyricData.offset;

                // 更新記憶體
                this.lyricsTimeAdjustments.set(trackId, {
                    trackInfo: lyricData.trackInfo,
                    timeOffset,
                    lastUpdated: Date.now()
                });

                // 更新 localStorage
                localOffsets[trackId] = {
                    trackInfo: lyricData.trackInfo,
                    timeOffset,
                    lastUpdated: Date.now()
                };

                newOffsetsCount++;
            }
        }

        localStorage.setItem(
            'lyrics_time_adjustments',
            JSON.stringify(localOffsets)
        );

        if (newOffsetsCount > 0) {
            this.log(`📥 已下載 ${newOffsetsCount} 個新時間調整從雲端`);
        } else {
            this.log(`✅ 本地時間調整已是最新`);
        }

        /* =========================
         * 2️⃣ 上傳本地時間調整到雲端
         * ========================= */
        let offsetUploadCount = 0;
        const localOffsetsFromStorage =
            JSON.parse(localStorage.getItem('lyrics_time_adjustments') || '{}');

        this.log(
            `📤 開始上傳本地時間調整到雲端: 共 ${Object.keys(localOffsetsFromStorage).length} 條`
        );

        for (const [trackId, offsetData] of Object.entries(localOffsetsFromStorage)) {
            try {
                if (!offsetData?.trackInfo?.id) {
                    this.log(`⚠️ 跳過無效數據: ${trackId}`);
                    continue;
                }

                const uploadResponse = await fetch('/api/kv/save-time-offset', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Session-Id': this.sessionId
                    },
                    body: JSON.stringify({
                        trackInfo: offsetData.trackInfo,
                        timeOffset: offsetData.timeOffset
                    })
                });

                if (!uploadResponse.ok) {
                    const text = await uploadResponse.text();
                    this.log(
                        `❌ 上傳失敗: ${uploadResponse.status} - ${text} - ${offsetData.trackInfo.name || trackId}`
                    );
                    continue;
                }

                offsetUploadCount++;
                this.log(`📤 已上傳: ${offsetData.trackInfo.name || trackId}`);
            } catch (err) {
                this.log(
                    `❌ 上傳單筆失敗: ${err.message} - ${offsetData.trackInfo?.name || trackId}`
                );
            }
        }

        this.log(`✅ 本地時間調整上傳完成: 成功 ${offsetUploadCount} 條`);
    } catch (error) {
        this.log(`❌ 時間調整同步失敗: ${error.message}`);
    }
}

    // 設定自動同步間隔
    setAutoSyncInterval(intervalMs) {
        this.autoSyncInterval = intervalMs;
        if (intervalMs) {
            localStorage.setItem('auto_sync_interval', intervalMs.toString());
        }
        
        if (this.autoSyncEnabled) {
            this.startAutoSync(); // 重啟同步以應用新間隔
        }
        
        this.log(`⏰ 自動同步間隔已設定為 ${intervalMs/1000}秒`);
    }

    // 切換自動同步開關
    toggleAutoSync() {
        this.autoSyncEnabled = !this.autoSyncEnabled;
        localStorage.setItem('auto_sync_enabled', String(this.autoSyncEnabled));
        
        if (this.autoSyncEnabled) {
            this.startAutoSync();
        } else {
            this.stopAutoSync();
        }
        
        this.log(`🔄 自動同步已${this.autoSyncEnabled ? '啟用' : '停用'}`);
        return this.autoSyncEnabled;
    }

    // 初始化同步控制事件
    initSyncControlEvents() {
        // 同步控制按鈕 - 開啟模態框
        document.getElementById('toggle-sync-controls')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSyncControlsModal();
        });

        // 關閉模態框
        document.getElementById('close-sync-modal')?.addEventListener('click', () => {
            this.hideSyncControlsModal();
        });

        // 點擊背景關閉模態框
        document.getElementById('sync-controls-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'sync-controls-modal') {
                this.hideSyncControlsModal();
            }
        });

        // 自動同步開關
        document.getElementById('auto-sync-toggle')?.addEventListener('change', (e) => {
            this.toggleAutoSync();
            this.updateSyncStatus();
        });

        // 同步間隔選擇
        document.getElementById('sync-interval-select')?.addEventListener('change', (e) => {
            const interval = parseInt(e.target.value);
            this.setAutoSyncInterval(interval);
            this.updateSyncStatus();
        });

        // 手動同步按鈕
        document.getElementById('manual-sync-btn')?.addEventListener('click', () => {
            this.performManualSync();
        });

        // 清除雲端按鈕
        document.getElementById('clear-kv-btn')?.addEventListener('click', () => {
            this.clearCloudData();
        });

        // 初始化同步狀態顯示
        this.updateSyncStatus();
        
        // 恢復同步控制設定
        this.restoreSyncControlSettings();
    }

    // 顯示同步控制模態框
    showSyncControlsModal() {
        const modal = document.getElementById('sync-controls-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('show');
            this.updateSyncStatus();
            this.updateConnectionStatus();
        }
    }

    // 隱藏同步控制模態框
    hideSyncControlsModal() {
        const modal = document.getElementById('sync-controls-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
        }
    }

    // 恢復同步控制設定
    restoreSyncControlSettings() {
        // 恢復自動同步開關狀態
        const toggleElement = document.getElementById('auto-sync-toggle');
        if (toggleElement) {
            toggleElement.checked = this.autoSyncEnabled;
        }

        // 恢復同步間隔設定
        const intervalSelect = document.getElementById('sync-interval-select');
        if (intervalSelect && this.autoSyncInterval) {
            intervalSelect.value = this.autoSyncInterval.toString();
        }
    }

    // 更新同步狀態顯示
    updateSyncStatus() {
        const syncIndicator = document.getElementById('sync-indicator');
        const syncStatusText = document.getElementById('sync-status-text');
        const lastSyncTimeElement = document.getElementById('last-sync-time');
        const localLyricsCountElement = document.getElementById('local-lyrics-count');
        const cloudStatusElement = document.getElementById('cloud-status');

        if (syncIndicator && syncStatusText) {
            if (this.autoSyncEnabled) {
                syncIndicator.className = 'sync-dot active';
                syncStatusText.textContent = '已啟用';
            } else {
                syncIndicator.className = 'sync-dot';
                syncStatusText.textContent = '已停用';
            }
        }

        if (lastSyncTimeElement) {
            if (this.lastSyncTime) {
                const lastSyncDate = new Date(this.lastSyncTime);
                lastSyncTimeElement.textContent = lastSyncDate.toLocaleString('zh-TW');
            } else {
                lastSyncTimeElement.textContent = '從未';
            }
        }

        if (localLyricsCountElement) {
            // 從 localStorage 獲取最新的本地歌詞數量
            try {
                const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
                const localLyricsCount = Object.keys(customLyrics).length;
                localLyricsCountElement.textContent = localLyricsCount.toString();
            } catch (error) {
                console.error('獲取本地歌詞數量失敗:', error);
                localLyricsCountElement.textContent = (this.savedLyrics?.size || 0).toString();
            }
        }

        if (cloudStatusElement) {
            cloudStatusElement.textContent = this.sessionId ? '已連接' : '未連接';
        }
    }

    // 執行手動同步
    async performManualSync() {
        const manualSyncBtn = document.getElementById('manual-sync-btn');
        let originalText = '';

        if (manualSyncBtn) {
            originalText = manualSyncBtn.innerHTML;
            manualSyncBtn.innerHTML = '<div class="loading"></div> 同步中...';
            manualSyncBtn.disabled = true;
        }

        try {
            await this.performAutoSync();
            // Refresh the local lyrics count after sync
            await this.refreshLocalLyricsCount();
            this.updateSyncStatus();
            this.showSyncMessage('✅ 手動同步完成', 'success');
        } catch (error) {
            this.showSyncMessage('❌ 同步失敗: ' + error.message, 'error');
        } finally {
            if (manualSyncBtn) {
                manualSyncBtn.innerHTML = originalText;
                manualSyncBtn.disabled = false;
            }
        }
    }

    // 刷新本地歌詞計數
    async refreshLocalLyricsCount() {
        try {
            // 重新從 localStorage 獲取數據
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const localLyricsCount = Object.keys(customLyrics).length;

            // 更新本地計數
            if (this.savedLyrics) {
                this.savedLyrics.clear();
                Object.entries(customLyrics).forEach(([key, value]) => {
                    this.savedLyrics.set(key, value);
                });
            }

            // 更新 UI 顯示
            const localLyricsCountElement = document.getElementById('local-lyrics-count');
            if (localLyricsCountElement) {
                localLyricsCountElement.textContent = localLyricsCount.toString();
            }
        } catch (error) {
            console.error('刷新本地歌詞計數失敗:', error);
        }
    }

    // 清除雲端數據
    async clearCloudData() {
        if (!confirm('確定要清除所有雲端數據嗎？此操作無法復原。')) {
            return;
        }

        const clearBtn = document.getElementById('clear-kv-btn');
        if (clearBtn) {
            const originalText = clearBtn.innerHTML;
            clearBtn.innerHTML = '<div class="loading"></div> 清除中...';
            clearBtn.disabled = true;
        }

        try {
            const response = await fetch('/api/kv/clear-all', {
                method: 'DELETE',
                headers: { 'X-Session-Id': this.sessionId }
            });

            if (response.ok) {
                this.showSyncMessage('✅ 雲端數據已清除', 'success');
                this.updateSyncStatus();
            } else {
                throw new Error('清除失敗');
            }
        } catch (error) {
            this.showSyncMessage('❌ 清除失敗: ' + error.message, 'error');
        } finally {
            if (clearBtn) {
                clearBtn.innerHTML = originalText;
                clearBtn.disabled = false;
            }
        }
    }

    // 顯示同步訊息
    showSyncMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `sync-message ${type}`;
        messageDiv.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: ${type === 'success' ? 'linear-gradient(135deg, #1db954, #1ed760)' : 
                         type === 'error' ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 
                         'rgba(0, 0, 0, 0.8)'};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            z-index: 2000;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            animation: slideIn 0.3s ease;
        `;
        messageDiv.textContent = message;
        document.body.appendChild(messageDiv);

        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.style.animation = 'slideIn 0.3s ease reverse';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.parentNode.removeChild(messageDiv);
                    }
                }, 300);
            }
        }, 3000);
    }

    // 更新連線狀態
    async updateConnectionStatus() {
        const connectionStatusElement = document.getElementById('connection-status');
        if (!connectionStatusElement) return;

        try {
            connectionStatusElement.textContent = '檢查中...';
            
            const response = await fetch('/api/health', {
                headers: this.sessionId ? { 'X-Session-Id': this.sessionId } : {},
                timeout: 5000
            });

            if (response.ok) {
                const data = await response.json();
                connectionStatusElement.textContent = data.spotify ? '已連線' : '未連線';
            } else {
                connectionStatusElement.textContent = '連線異常';
            }
        } catch (error) {
            connectionStatusElement.textContent = '連線失敗';
        }
    }

    // 初始化手機版歌詞控制
    initMobileLyricsControls() {
        // 觸發按鈕事件
        document.getElementById('mobile-lyrics-trigger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMobileLyricsPanel();
        });

        // 點擊外部關閉面板
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.mobile-lyrics-controls')) {
                this.hideMobileLyricsPanel();
            }
        });

        // 歌詞時間控制
        document.getElementById('mobile-lyrics-fast')?.addEventListener('click', () => {
            this.adjustLyricsOffset(-100);
            this.hideMobileLyricsPanel();
        });

        document.getElementById('mobile-lyrics-reset')?.addEventListener('click', () => {
            this.resetLyricsOffset();
            this.hideMobileLyricsPanel();
        });

        document.getElementById('mobile-lyrics-slow')?.addEventListener('click', () => {
            this.adjustLyricsOffset(100);
            this.hideMobileLyricsPanel();
        });

        // 其他歌詞功能
        document.getElementById('mobile-search')?.addEventListener('click', () => {
            this.showLyricsSearchModal();
            this.hideMobileLyricsPanel();
        });

        document.getElementById('mobile-download')?.addEventListener('click', () => {
            this.downloadCurrentLyrics();
            this.hideMobileLyricsPanel();
        });

        document.getElementById('mobile-upload')?.addEventListener('click', () => {
            document.getElementById('upload-lyrics-btn')?.click();
            this.hideMobileLyricsPanel();
        });

        // 手動同步
        document.getElementById('mobile-manual-sync')?.addEventListener('click', () => {
            this.performManualSync();
            this.updateMobileSyncStatus();
        });

        // 初始化手機同步狀態
        this.updateMobileSyncStatus();
    }

    // 切換手機版歌詞面板
    toggleMobileLyricsPanel() {
        const panel = document.getElementById('mobile-lyrics-panel');
        if (panel) {
            const isVisible = panel.classList.contains('show');
            if (isVisible) {
                this.hideMobileLyricsPanel();
            } else {
                this.showMobileLyricsPanel();
            }
        }
    }

    // 顯示手機版歌詞面板
    showMobileLyricsPanel() {
        const panel = document.getElementById('mobile-lyrics-panel');
        if (panel) {
            panel.classList.add('show');
            this.updateMobileSyncStatus();
        }
    }

    // 隱藏手機版歌詞面板
    hideMobileLyricsPanel() {
        const panel = document.getElementById('mobile-lyrics-panel');
        if (panel) {
            panel.classList.remove('show');
        }
    }

    // 更新手機版同步狀態
    updateMobileSyncStatus() {
        const indicator = document.getElementById('mobile-sync-indicator');
        const statusText = document.getElementById('mobile-sync-status-text');

        if (indicator && statusText) {
            if (this.autoSyncEnabled) {
                indicator.className = 'sync-dot active';
                statusText.textContent = '已啟用';
            } else {
                indicator.className = 'sync-dot';
                statusText.textContent = '已停用';
            }
        }
    }

    // 初始化保存的歌詞和時間調整
    initSavedLyricsAndAdjustments() {
        try {
            // 載入保存的歌詞 (優先載入)
            const savedLyrics = localStorage.getItem('saved_lyrics');
            if (savedLyrics) {
                const savedData = JSON.parse(savedLyrics);
                for (const [key, value] of Object.entries(savedData)) {
                    // **修改點：確保載入的鍵也經過相同的處理**
                    const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
                    this.savedLyrics.set(normalizedKey, value);
                }
                this.log(`💎 已載入 ${this.savedLyrics.size} 個保存的歌詞 (已標準化鍵值)`);
            }

            // 載入歌詞時間調整
            const timeAdjustments = localStorage.getItem('lyrics_time_adjustments');
            if (timeAdjustments) {
                const adjustmentData = JSON.parse(timeAdjustments);
                for (const [key, value] of Object.entries(adjustmentData)) {
                    // **修改點：確保載入的時間調整鍵也經過相同的處理**
                    const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
                    this.lyricsTimeAdjustments.set(normalizedKey, value);
                }
                this.log(`⏰ 已載入 ${this.lyricsTimeAdjustments.size} 個歌詞時間調整 (已標準化鍵值)`);
            }
        } catch (error) {
            this.log(`❌ 載入保存的歌詞和時間調整失敗: ${error.message}`);
            // 如果載入失敗，清空 localStorage 以防止持續錯誤
            localStorage.removeItem('saved_lyrics');
            localStorage.removeItem('lyrics_time_adjustments');
        }
    }

    // 生成歌曲緩存鍵值
    generateTrackCacheKey(track) {
        return `${track.id}-${track.name}-${track.artist}`.toLowerCase().replace(/\s+/g, '_');
    }

    // 從緩存獲取歌詞 (優先順序: 保存的歌詞 > 緩存歌詞)
    getCachedLyrics(track) {
        const cacheKey = this.generateTrackCacheKey(track); // 確保這裡生成的 key 是標準化的
        this.log(`🔍 檢查緩存歌詞，鍵值: ${cacheKey}`); // 加入日誌方便除錯

        // 1. 優先檢查保存的歌詞
        const savedLyrics = this.savedLyrics.get(cacheKey); // 使用標準化的 key 查找
        if (savedLyrics) {
            this.log(`💎 從保存的歌詞載入: ${track.name} - ${track.artist}`);
            // 套用時間調整 (如果有的話)
            // ✨ 修復：同時檢查 trackId 鍵（用於舊數據兼容性）
            let timeAdjustment = this.lyricsTimeAdjustments.get(cacheKey); // 使用標準化的 key 查找
            if (!timeAdjustment && track.id) {
                timeAdjustment = this.lyricsTimeAdjustments.get(track.id); // 備用：使用 trackId
            }
            if (timeAdjustment && savedLyrics.lyrics) {
                // ✨ 修復：確保正確提取時間偏移值
                const timeOffset = typeof timeAdjustment === 'number' ? timeAdjustment : timeAdjustment.timeOffset;
                this.log(`⏰ 為 ${track.name} 應用已保存的時間調整: ${timeOffset}ms`);
                return {
                    ...savedLyrics,
                    lyrics: this.applyTimeAdjustmentToLyrics(savedLyrics.lyrics, timeOffset)
                };
            }
            return savedLyrics;
        }

        // 2. 檢查一般緩存
        const cached = this.lyricsCache.get(cacheKey); // 使用標準化的 key 查找
        if (cached && (Date.now() - cached.timestamp) < this.lyricsCacheExpiry) {
            this.log(`💾 從一般緩存載入: ${track.name} - ${track.artist}`);
            // 套用時間調整 (如果有的話)
            // ✨ 修復：同時檢查 trackId 鍵（用於舊數據兼容性）
            let timeAdjustment = this.lyricsTimeAdjustments.get(cacheKey); // 使用標準化的 key 查找
            if (!timeAdjustment && track.id) {
                timeAdjustment = this.lyricsTimeAdjustments.get(track.id); // 備用：使用 trackId
            }
            if (timeAdjustment && cached.lyrics) {
                // ✨ 修復：確保正確提取時間偏移值
                const timeOffset = typeof timeAdjustment === 'number' ? timeAdjustment : timeAdjustment.timeOffset;
                this.log(`⏰ 為 ${track.name} 應用時間調整 (從緩存): ${timeOffset}ms`);
                return {
                    ...cached,
                    lyrics: this.applyTimeAdjustmentToLyrics(cached.lyrics, timeOffset)
                };
            }
            return cached;
        }

        // 清理過期緩存
        if (cached) {
            this.lyricsCache.delete(cacheKey);
            this.saveLyricsCacheToStorage();
        }

        return null;
    }

    // 保存歌詞到緩存
    cacheLyrics(track, lyrics, lyricsType) {
        const cacheKey = this.generateTrackCacheKey(track);
        const cacheData = {
            lyrics: lyrics,
            lyricsType: lyricsType,
            timestamp: Date.now(),
            trackInfo: {
                id: track.id,
                name: track.name,
                artist: track.artist
            }
        };
        
        this.lyricsCache.set(cacheKey, cacheData);
        this.saveLyricsCacheToStorage();
        this.log(`💾 已緩存歌詞: ${track.name} - ${track.artist}`);
    }

    // 保存歌詞 (永久保存，播放時優先載入)
    saveLyrics(track, lyrics, lyricsType, source = 'manual') {
        if (!track || !lyrics || !Array.isArray(lyrics) || lyrics.length === 0) {
            this.log('⚠️ 無法保存無效的歌詞數據');
            return;
        }

        const cacheKey = this.generateTrackCacheKey(track); // 確保這裡生成的 key 是標準化的
        const savedData = {
            lyrics: lyrics,
            lyricsType: lyricsType,
            timestamp: Date.now(),
            source: source,
            trackInfo: {
                id: track.id,
                name: track.name,
                artist: track.artist
            }
        };

        this.savedLyrics.set(cacheKey, savedData); // 使用標準化的 key 保存
        this.saveSavedLyricsToStorage(); // 觸發保存到 localStorage

        // 也緩存到一般緩存 (可選，但通常會這樣做)
        this.cacheLyrics(track, lyrics, lyricsType);

        this.log(`💾 歌詞已保存至本地: ${track.name} - ${track.artist} (鍵值: ${cacheKey})`);
    }

    // 保存歌詞時間調整
    saveLyricsTimeAdjustment(track, timeOffset) {
    if (!track) {
        this.log('⚠️ 无法保存时间调整，缺少 track 信息');
        return;
    }

    const cacheKey = this.generateTrackCacheKey(track);
    
    if (timeOffset === 0 || timeOffset === null || timeOffset === undefined) {
        this.lyricsTimeAdjustments.delete(cacheKey);
        this.log(`🧹 已移除 ${track.name} 的时间调整`);
    } else {
        const adjustmentData = {
            timeOffset: timeOffset,
            timestamp: Date.now(),
            trackInfo: {
                id: track.id,
                name: track.name,
                artist: track.artist
            }
        };
        this.lyricsTimeAdjustments.set(cacheKey, adjustmentData);
        this.log(`⏰ 歌词时间调整已保存 (${timeOffset}ms) for ${track.name}`);
    }

    this.saveTimeAdjustmentsToStorage();
    
    // ✨ 新增：同时保存到服务器 KV
    this.syncTimeOffsetToServer(track, timeOffset);
}

// ✨ 新增：同步时间偏移到服务器
async syncTimeOffsetToServer(track, timeOffset) {
    try {
        const response = await fetch('/api/kv/save-time-offset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': this.sessionId
            },
            body: JSON.stringify({
                trackInfo: {
                    id: track.id,
                    name: track.name,
                    artist: track.artist
                },
                timeOffset: timeOffset
            })
        });
        
        if (response.ok) {
            this.log(`✅ 时间偏移已同步到服务器`);
        }
    } catch (error) {
        this.log(`⚠️ 同步时间偏移失败: ${error.message}`);
    }
}

// 核心同步逻辑
async loadUserSettingsFromKV() {
    try {
        // 1. 检查是否有 KV 中的数据
        const response = await fetch('/api/kv/user-lyrics', {
            headers: { 'X-Session-Id': this.sessionId }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // 2. 将 KV 数据同步到本地
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach(lyricData => {
                    const cacheKey = this.generateTrackCacheKey(lyricData.trackInfo);
                    this.savedLyrics.set(cacheKey, lyricData);
                });
                
                this.saveSavedLyricsToStorage();
                this.log(`✅ 已从 KV 加载 ${data.data.length} 条歌词`);
            }
        }
    } catch (error) {
        this.log(`⚠️ 从 KV 加载数据失败: ${error.message}`);
    }
}

// 在初始化时调用
async initializeStorage() {
    // 加载本地数据
    this.initSavedLyricsAndAdjustments();
    
    // 加载 KV 数据并同步
    await this.loadUserSettingsFromKV();
    
    this.log('✅ 存储初始化完成');
}

    // 套用時間調整到歌詞
    // ✨ 修復：確保正確處理時間調整數據（包含逐字歌詞）
    applyTimeAdjustmentToLyrics(lyrics, timeOffset) {
        // 如果時間偏移為 0 或不存在，直接返回原歌詞
        if (!timeOffset || timeOffset === 0) {
            return lyrics;
        }

        // 確保 timeOffset 是數字
        const offset = typeof timeOffset === 'number' ? timeOffset : (timeOffset.timeOffset || 0);
        if (!offset || offset === 0) {
            return lyrics;
        }

        // 如果歌詞是純文字（非同步歌詞），直接返回
        if (!Array.isArray(lyrics) || lyrics.length === 0) {
            return lyrics;
        }

        // 檢查歌詞是否有時間戳
        const firstLyric = lyrics[0];
        if (!firstLyric || typeof firstLyric !== 'object' || !('time' in firstLyric)) {
            // 無時間戳，返回原歌詞
            return lyrics;
        }

        // 對每條歌詞的時間戳進行調整（包含逐字歌詞）
        return lyrics.map(lyric => {
            if (!lyric || typeof lyric !== 'object') {
                return lyric;
            }
            
            const adjustedLyric = { ...lyric };
            
            // 調整行時間
            if (adjustedLyric.time !== undefined) {
                adjustedLyric.time = Math.max(0, adjustedLyric.time + offset);
            }
            
            // ✨ 關鍵修復：調整逐字歌詞中每個字的時間
            if (adjustedLyric.words && Array.isArray(adjustedLyric.words)) {
                adjustedLyric.words = adjustedLyric.words.map(word => {
                    if (!word || typeof word !== 'object') {
                        return word;
                    }
                    
                    const adjustedWord = { ...word };
                    
                    // 調整單字開始時間
                    if (adjustedWord.time !== undefined) {
                        adjustedWord.time = Math.max(0, adjustedWord.time + offset);
                    }
                    
                    // 如果有 start/end 格式，也要調整
                    if (adjustedWord.start !== undefined) {
                        adjustedWord.start = Math.max(0, adjustedWord.start + offset);
                    }
                    if (adjustedWord.end !== undefined) {
                        adjustedWord.end = Math.max(0, adjustedWord.end + offset);
                    }
                    
                    return adjustedWord;
                });
            }
            
            return adjustedLyric;
        });
    }

    // 保存緩存到 localStorage
    saveLyricsCacheToStorage() {
        try {
            const cacheObject = {};
            for (const [key, value] of this.lyricsCache.entries()) {
                cacheObject[key] = value;
            }
            localStorage.setItem('lyrics_cache', JSON.stringify(cacheObject));
        } catch (error) {
            this.log(`❌ 保存歌詞緩存失敗: ${error.message}`);
            // 如果存儲空間不足，清理部分緩存
            if (error.name === 'QuotaExceededError') {
                this.cleanupLyricsCache();
            }
        }
    }

    // 保存保存的歌詞到 localStorage
    saveSavedLyricsToStorage() {
        try {
            const savedObject = {};
            for (const [key, value] of this.savedLyrics.entries()) {
                savedObject[key] = value;
            }
            localStorage.setItem('saved_lyrics', JSON.stringify(savedObject));
        } catch (error) {
            this.log(`❌ 保存永久歌詞失敗: ${error.message}`);
            if (error.name === 'QuotaExceededError') {
                this.cleanupSavedLyrics();
            }
        }
    }

    // 保存時間調整到 localStorage
    saveTimeAdjustmentsToStorage() {
        try {
            const adjustmentObject = {};
            for (const [key, value] of this.lyricsTimeAdjustments.entries()) {
                adjustmentObject[key] = value;
            }
            localStorage.setItem('lyrics_time_adjustments', JSON.stringify(adjustmentObject));
        } catch (error) {
            this.log(`❌ 保存歌詞時間調整失敗: ${error.message}`);
            if (error.name === 'QuotaExceededError') {
                this.cleanupTimeAdjustments();
            }
        }
    }

    // 清理歌詞緩存
    cleanupLyricsCache() {
        const entries = Array.from(this.lyricsCache.entries());
        // 按時間戳排序，刪除最舊的一半
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.slice(0, Math.floor(entries.length / 2));
        
        toDelete.forEach(([key]) => {
            this.lyricsCache.delete(key);
        });
        
        this.saveLyricsCacheToStorage();
        this.log(`🧹 已清理 ${toDelete.length} 個舊的歌詞緩存`);
    }

    // 清理保存的歌詞
    cleanupSavedLyrics() {
        const entries = Array.from(this.savedLyrics.entries());
        // 按時間戳排序，刪除最舊的一半
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.slice(0, Math.floor(entries.length / 2));
        
        toDelete.forEach(([key]) => {
            this.savedLyrics.delete(key);
        });
        
        this.saveSavedLyricsToStorage();
        this.log(`🧹 已清理 ${toDelete.length} 個舊的保存歌詞`);
    }

    // 清理時間調整
    cleanupTimeAdjustments() {
        const entries = Array.from(this.lyricsTimeAdjustments.entries());
        // 按時間戳排序，刪除最舊的一半
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.slice(0, Math.floor(entries.length / 2));
        
        toDelete.forEach(([key]) => {
            this.lyricsTimeAdjustments.delete(key);
        });
        
        this.saveTimeAdjustmentsToStorage();
        this.log(`🧹 已清理 ${toDelete.length} 個舊的時間調整`);
    }

    handleAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'success') {
            this.sessionId = urlParams.get('session');
            if (this.sessionId) {
                localStorage.setItem('spotify_session_id', this.sessionId);
                try {
                    localStorage.setItem('spotify_session_data', JSON.stringify({ sessionId: this.sessionId, savedAt: Date.now() }));
                } catch (e) {}
                this.protectSession();
                this.log(`✅ 新 sessionId 已保存: ${this.sessionId.substring(0, 8)}...`);
                if (this.authChannel) {
                    this.authChannel.postMessage({ type: 'session-update', sessionId: this.sessionId });
                }
            }
            window.history.replaceState({}, document.title, window.location.pathname);
            this.showSuccessMessage('🎉 Spotify 連接成功！');
            
            // 通知增強 Session 管理器重置重試計數器
            if (this.sessionManager) {
                this.sessionManager.resetRetryCount();
            }
        } else {
            // 嘗試從 localStorage 恢復 sessionId
            const storedSessionId = localStorage.getItem('spotify_session_id');
            if (storedSessionId) {
                this.sessionId = storedSessionId;
                try {
                    localStorage.setItem('spotify_session_data', JSON.stringify({ sessionId: this.sessionId, savedAt: Date.now() }));
                } catch (e) {}
                this.protectSession();
                this.log(`🔄 從 localStorage 恢復 sessionId: ${this.sessionId.substring(0, 8)}...`);
                if (this.authChannel) {
                    this.authChannel.postMessage({ type: 'session-update', sessionId: this.sessionId });
                }
            } else {
                this.log('ℹ️ 沒有找到保存的 sessionId');
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

    // 🔧 新增：當這台裝置被「其他裝置」遙控時顯示提示，讓正在看畫面的人知道發生了什麼事
    // (與本機自己操作時的 showOffsetMessage/showSuccessMessage 區隔開，加上手機圖示前綴)
    showRemoteControlToast(message) {
        this.showSuccessMessage(`📱 ${message}`);
    }

    formatOffsetToastMessage(offset) {
        return offset === 0
            ? '其他裝置已將歌詞時間重置'
            : `其他裝置已將歌詞${offset > 0 ? '延後' : '提前'} ${Math.abs(offset / 1000).toFixed(1)} 秒`;
    }

    formatManualLyricsToastMessage(manualLyrics) {
        if (!manualLyrics) return '其他裝置已切換回自動歌詞';
        const label = manualLyrics.title
            ? `${manualLyrics.title}${manualLyrics.artist ? ' - ' + manualLyrics.artist : ''}`
            : (manualLyrics.source || '手動歌詞');
        return `其他裝置已切換歌詞來源：${label}`;
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
        
        // 增強功能按鈕
        this.shareSongBtn = document.getElementById('share-song-btn');
        this.addToPlaylistsBtn = document.getElementById('add-to-playlists-btn');
        this.exportLyricsBtn = document.getElementById('export-lyrics-btn');
        
        // 下一首歌曲預覽元素
        this.nextSongPreview = document.getElementById('next-song-preview');
        this.nextSongCover = document.getElementById('next-song-cover');
        this.nextSongTitle = document.getElementById('next-song-title');
        this.nextSongArtist = document.getElementById('next-song-artist');
        this.togglePreviewSettings = document.getElementById('toggle-preview-settings');
        this.previewSettingsDropdown = document.getElementById('preview-settings-dropdown');
        
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
        
        // 增強模態框
        this.userPlaylistsModal = document.getElementById('user-playlists-modal');
        this.userPlaylistsContent = document.getElementById('user-playlists-content');
        this.closeUserPlaylistsModalBtn = document.getElementById('close-user-playlists-modal');
        this.exportLyricsOptionsModal = document.getElementById('export-lyrics-options-modal');
        this.closeExportModalBtn = document.getElementById('close-export-modal');
        this.exportWbwBtn = document.getElementById('export-wbw-btn');
        this.exportLrcBtn = document.getElementById('export-lrc-btn');
        
        // 設置模態框元素
        this.settingsModal = document.getElementById('settings-modal');
        this.saveSettingsBtn = document.getElementById('save-settings-btn');
        this.closeSettingsModalBtn = document.getElementById('close-settings-modal');
        this.languageSelect = document.getElementById('language-select');
        this.themeSelect = document.getElementById('theme-select');
        
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

        // 設置按鈕事件
        this.settingsBtn?.addEventListener('click', () => {
            this.openSettingsModal();
        });

        // 關閉設置模態框
        this.closeSettingsModalBtn?.addEventListener('click', () => {
            this.closeSettingsModal();
        });

        // 保存設置
        this.saveSettingsBtn?.addEventListener('click', () => {
            this.saveSettings();
        });

        // 點擊設置模態框背景關閉
        this.settingsModal?.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                this.closeSettingsModal();
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

        // 增強功能按鈕事件
        this.shareSongBtn?.addEventListener('click', () => {
            this.copySongLink();
        });

        this.addToPlaylistsBtn?.addEventListener('click', () => {
            this.showUserPlaylistsModal();
        });

        this.exportLyricsBtn?.addEventListener('click', () => {
            this.showExportLyricsOptionsModal();
        });

        // 模態框關閉事件
        this.closePlaylistModalBtn?.addEventListener('click', () => {
            this.playlistModal.style.display = 'none';
        });

        this.closeDevicesModalBtn?.addEventListener('click', () => {
            this.devicesModal.style.display = 'none';
        });

        this.closeUserPlaylistsModalBtn?.addEventListener('click', () => {
            this.userPlaylistsModal.style.display = 'none';
        });

        this.closeExportModalBtn?.addEventListener('click', () => {
            this.exportLyricsOptionsModal.style.display = 'none';
        });

        // 匯出選項按鈕
        this.exportWbwBtn?.addEventListener('click', () => {
            this.exportLyrics('syllabic');
            this.exportLyricsOptionsModal.style.display = 'none';
        });

        this.exportLrcBtn?.addEventListener('click', () => {
            this.exportLyrics('lrc');
            this.exportLyricsOptionsModal.style.display = 'none';
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

        this.userPlaylistsModal?.addEventListener('click', (e) => {
            if (e.target === this.userPlaylistsModal) {
                this.userPlaylistsModal.style.display = 'none';
            }
        });

        this.exportLyricsOptionsModal?.addEventListener('click', (e) => {
            if (e.target === this.exportLyricsOptionsModal) {
                this.exportLyricsOptionsModal.style.display = 'none';
            }
        });

        // 歌詞時間控制按鈕事件
        document.getElementById('lyrics-fast-btn')?.addEventListener('click', () => {
            this.adjustLyricsOffset(-100); // 快0.1秒
        });

        document.getElementById('lyrics-reset-btn')?.addEventListener('click', () => {
            this.resetLyricsOffset(); // 重置
        });

        document.getElementById('lyrics-slow-btn')?.addEventListener('click', () => {
            this.adjustLyricsOffset(100); // 慢0.1秒
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
        
        // 初始化预览检查时间戳
        this.lastPreviewCheck = 0;
        
        // 初始化播放器元素引用
        this.playerSection = document.querySelector('.player-section');
        
        // 初始化自动登录防护
        this.lastAutoLoginAttempt = 0;
        this.consecutiveAuthErrors = 0;
        
        // 初始化同步控制事件
        this.initSyncControlEvents();
        
        // 初始化手機版歌詞控制
        this.initMobileLyricsControls();
    }

    // 初始化下一首歌曲預覽設定
    initNextSongPreviewSettings() {
        // 設定按鈕事件
        this.togglePreviewSettings?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePreviewSettingsDropdown();
        });

        // 點擊外部關閉下拉菜單
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.preview-settings-section')) {
                this.hidePreviewSettingsDropdown();
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

    // 切換預覽設定下拉菜單
    togglePreviewSettingsDropdown() {
        const isVisible = this.previewSettingsDropdown.style.display === 'block';
        if (isVisible) {
            this.hidePreviewSettingsDropdown();
        } else {
            this.showPreviewSettingsDropdown();
        }
    }

    // 顯示預覽設定下拉菜單
    showPreviewSettingsDropdown() {
        this.previewSettingsDropdown.style.display = 'block';
    }

    // 隱藏預覽設定下拉菜單
    hidePreviewSettingsDropdown() {
        this.previewSettingsDropdown.style.display = 'none';
    }

    // 更新下一首歌曲預覽模式
    updateNextSongPreviewMode(mode) {
        this.nextSongPreviewMode = mode;
        localStorage.setItem('nextSongPreviewMode', mode);
        this.log(`🎵 下一首歌曲預覽模式已更新: ${mode}`);
        
        // 立即應用新設定
        this.applyNextSongPreviewMode();
        this.hidePreviewSettingsDropdown();
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
        this.log(`🎵 準備顯示下一首預覽 - 模式: ${this.nextSongPreviewMode}, 有數據: ${!!this.nextSongData}`);
        
        if (this.nextSongPreviewMode === 'never' || !this.nextSongData) {
            this.log(`⏸️ 跳過顯示 - 模式為never或無數據`);
            return;
        }

        // 更新預覽內容
        this.updateNextSongPreviewContent();
        
        // 顯示預覽with動畫
        if (this.nextSongPreview) {
            // 移除之前的动画类
            this.nextSongPreview.classList.remove('slide-out');
            // 显示元素
            this.nextSongPreview.style.display = 'block';
            // 添加滑入动画
            this.nextSongPreview.classList.add('slide-in');
            this.isNextSongPreviewShown = true;
            this.log(`✅ 下一首預覽已顯示: ${this.nextSongData.name || 'Unknown'}`);
        } else {
            this.log(`❌ 找不到預覽UI元素`);
        }
    }

    // 更新下一首預覽
    updateNextTrackPreview() {
        // 獲取下一首歌曲信息並更新預覽
        if (this.currentTrack && this.currentTrack.queue && this.currentTrack.queue.length > 0) {
            const nextTrack = this.currentTrack.queue[0];
            this.nextSongData = {
                id: nextTrack.id,
                name: nextTrack.name || '',
                artist: nextTrack.artists?.map(a => a.name).join(', ') || nextTrack.artist || '',
                image: nextTrack.image || nextTrack.album?.images?.[0]?.url || null
            };
            
            // 更新預覽內容
            this.updateNextTrackPreviewContent();
        }
        
        // 根據設定處理預覽顯示
        if (this.nextSongPreviewMode === 'always') {
            this.showNextSongPreviewAlways();
        } else {
            // 清除現有的預覽定時器並重新安排
            if (this.nextSongPreviewTimeout) {
                clearTimeout(this.nextSongPreviewTimeout);
                this.nextSongPreviewTimeout = null;
            }
            this.isNextSongPreviewShown = false;
            
            // 如果音樂正在播放，安排下一首預覽
            if (this.currentTrack?.isPlaying && this.nextSongPreviewMode !== 'never') {
                this.scheduleNextSongPreview();
            }
        }
    }

    // 隱藏下一首歌曲預覽
    hideNextSongPreview() {
        if (this.nextSongPreview && this.isNextSongPreviewShown) {
            // 添加滑出动画
            this.nextSongPreview.classList.remove('slide-in');
            this.nextSongPreview.classList.add('slide-out');
            
            // 动画完成后隐藏元素
            setTimeout(() => {
                if (this.nextSongPreview) {
                    this.nextSongPreview.style.display = 'none';
                    this.nextSongPreview.classList.remove('slide-out');
                }
            }, 500); // 对应动画时长
            
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
        if (!this.nextSongData) {
            this.log('⚠️ 无下一首数据，跳过内容更新');
            return;
        }

        const { name, artists, album, artist, image, lyricsPreview } = this.nextSongData;
        this.log(`📝 更新下一首预览内容: ${name} - ${artist || (artists ? artists[0]?.name : 'Unknown')}`);
        
        if (this.nextSongTitle) {
            const songName = name || '';
            this.nextSongTitle.textContent = typeof convertToTraditional === 'function' ? 
                convertToTraditional(songName) : songName;
        }
        
        if (this.nextSongArtist) {
            const artistNames = artist || (artists ? artists.map(a => a.name).join(', ') : '');
            this.nextSongArtist.textContent = typeof convertToTraditional === 'function' ? 
                convertToTraditional(artistNames) : artistNames;
        }
        
        // 添加歌詞預覽顯示
        const lyricsPreviewElement = document.getElementById('next-song-lyrics-preview');
        if (lyricsPreviewElement) {
            if (lyricsPreview && lyricsPreview.trim()) {
                lyricsPreviewElement.textContent = lyricsPreview;
                lyricsPreviewElement.style.display = 'block';
            } else {
                lyricsPreviewElement.style.display = 'none';
            }
        }
        
        if (this.nextSongCover) {
            const coverUrl = image || (album && album.images && album.images.length > 0 ? album.images[0].url : null);
            if (coverUrl) {
                this.nextSongCover.src = coverUrl;
            } else {
                this.nextSongCover.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMjAgMGMxMSAwIDIwIDkgMjAgMjBzLTkgMjAtMjAgMjBTMCAzMSAwIDIwIDkgMCAyMCAweiIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjIwIiB5PSIyNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn465PC90ZXh0Pjwvc3ZnPg==';
            }
        }
    }

    // 安排下一首歌曲預覽（使用自定义进度）
    scheduleNextSongPreviewWithProgress(customProgress) {
        this.log(`🎵 安排下一首預覽 (自定義進度) - 模式: ${this.nextSongPreviewMode}`);
        
        if (!this.currentTrack || this.nextSongPreviewMode === 'never') {
            this.log(`⏸️ 跳過預覽安排 - 無歌曲或模式為never`);
            return;
        }

        const currentTime = customProgress || 0;
        const duration = this.currentTrack.duration || 0;
        
        this.log(`⏰ 時間信息 (自定義) - 當前: ${Math.floor(currentTime/1000)}s, 總長: ${Math.floor(duration/1000)}s`);
        
        if (duration === 0) {
            this.log(`❌ 歌曲時長為0，跳過預覽`);
            return;
        }

        const remainingTime = duration - currentTime;
        this.log(`⏳ 剩餘時間: ${Math.floor(remainingTime/1000)}秒`);
        
        // 根據預覽模式決定顯示時機
        let showAtSeconds = 10; // 預設10秒
        if (this.nextSongPreviewMode === '20') showAtSeconds = 20;
        else if (this.nextSongPreviewMode === '30') showAtSeconds = 30;
        
        const showAtMs = showAtSeconds * 1000;
        
        this.log(`🎯 下一首數據狀態: ${this.nextSongData ? '有數據' : '無數據'}`);
        
        if (this.nextSongPreviewMode === 'always') {
            // 始終顯示模式
            this.log(`🔄 始終顯示模式`);
            if (this.nextSongData && !this.isNextSongPreviewShown) {
                this.showNextSongPreview();
            }
        } else if (remainingTime <= showAtMs && remainingTime > 0 && !this.isNextSongPreviewShown) {
            // 時間到了立即顯示 - 增加remainingTime > 0的检查
            this.log(`⏰ 時間已到，立即顯示預覽 (剩餘${Math.floor(remainingTime/1000)}s <= ${showAtSeconds}s)`);
            if (this.nextSongData) {
                this.showNextSongPreview();
            } else {
                this.log(`⚠️ 無下一首數據，無法顯示預覽`);
            }
        } else if (remainingTime > showAtMs && this.isNextSongPreviewShown) {
            // 如果剩余时间还很多但预览已显示，隐藏它
            this.log(`⏰ 剩餘時間較多，隐藏預覽 (剩餘${Math.floor(remainingTime/1000)}s > ${showAtSeconds}s)`);
            this.hideNextSongPreview();
        } else {
            this.log(`ℹ️ 不滿足顯示條件 - 剩餘${Math.floor(remainingTime/1000)}s, 需要${showAtSeconds}s, 已顯示: ${this.isNextSongPreviewShown}`);
        }
    }

    // 安排下一首歌曲預覽
    scheduleNextSongPreview() {
        this.log(`🎵 安排下一首預覽 - 模式: ${this.nextSongPreviewMode}`);
        
        if (!this.currentTrack || this.nextSongPreviewMode === 'never') {
            this.log(`⏸️ 跳過預覽安排 - 無歌曲或模式為never`);
            return;
        }

        // 清除之前的定時器
        if (this.nextSongPreviewTimeout) {
            clearTimeout(this.nextSongPreviewTimeout);
            this.nextSongPreviewTimeout = null;
        }

        const currentTime = this.currentTrack.progress || 0;
        const duration = this.currentTrack.duration || 0;
        
        this.log(`⏰ 時間信息 - 當前: ${Math.floor(currentTime/1000)}s, 總長: ${Math.floor(duration/1000)}s`);
        
        if (duration === 0) {
            this.log(`❌ 歌曲時長為0，跳過預覽`);
            return;
        }

        const remainingTime = duration - currentTime;
        this.log(`⏳ 剩餘時間: ${Math.floor(remainingTime/1000)}秒`);
        
        // 根據預覽模式決定顯示時機
        let showAtSeconds = 10; // 預設10秒
        if (this.nextSongPreviewMode === '20') showAtSeconds = 20;
        else if (this.nextSongPreviewMode === '30') showAtSeconds = 30;
        
        const showAtMs = showAtSeconds * 1000;
        
        this.log(`🎯 下一首數據狀態: ${this.nextSongData ? '有數據' : '無數據'}`);
        
        if (this.nextSongPreviewMode === 'always') {
            // 始終顯示模式
            this.log(`🔄 始終顯示模式`);
            if (this.nextSongData) {
                this.showNextSongPreview();
            } else {
                this.log(`⚠️ 無下一首數據，無法顯示預覽`);
            }
        } else if (remainingTime <= showAtMs && !this.isNextSongPreviewShown) {
            // 時間到了立即顯示
            this.log(`⏰ 時間已到，立即顯示預覽 (剩餘${Math.floor(remainingTime/1000)}s <= ${showAtSeconds}s)`);
            if (this.nextSongData) {
                this.showNextSongPreview();
            } else {
                this.log(`⚠️ 無下一首數據，無法顯示預覽`);
            }
        } else if (remainingTime > showAtMs) {
            // 設定定時器在指定時間顯示
            const timeToShow = remainingTime - showAtMs;
            this.log(`⏰ 設定定時器 - ${Math.floor(timeToShow/1000)}秒後顯示預覽`);
            this.nextSongPreviewTimeout = setTimeout(() => {
                this.log(`⏰ 定時器觸發，檢查下一首數據`);
                if (this.nextSongData) {
                    this.showNextSongPreview();
                } else {
                    this.log(`⚠️ 定時器觸發時無下一首數據`);
                }
            }, timeToShow);
        } else {
            this.log(`ℹ️ 不滿足顯示條件 - 剩餘${Math.floor(remainingTime/1000)}s, 需要${showAtSeconds}s, 已顯示: ${this.isNextSongPreviewShown}`);
        }
    }

    // 獲取下一首歌曲信息
    async fetchNextSongData() {
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }
            
            const response = await fetch(`${this.apiBase}/api/player/queue`, { 
                headers,
                credentials: 'same-origin'
            });
            
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

    // 更新播放按鈕狀態（不影響專輯背景）
    updatePlayButtonState(isPlaying) {
        if (this.playPauseBtn && this.playIcon && this.pauseIcon) {
            if (isPlaying) {
                this.playIcon.style.display = 'none';
                this.pauseIcon.style.display = 'block';
                this.playPauseBtn.classList.add('playing');
            } else {
                this.playIcon.style.display = 'block';
                this.pauseIcon.style.display = 'none';
                this.playPauseBtn.classList.remove('playing');
            }
            this.log(`🎮 播放按鈕狀態已更新: ${isPlaying ? '暫停按鈕' : '播放按鈕'}`);
        }
    }

    // 確保專輯背景容器保持可見
    ensureAlbumBackgroundVisible() {
        const bgContainer = document.getElementById('album-bg-container');
        if (bgContainer) {
            // 確保背景容器不會因為播放狀態改變而消失
            bgContainer.style.display = 'block';
            bgContainer.style.visibility = 'visible';
            this.log('🖼️ 確保專輯背景容器保持可見');
        }
    }

    // 確保播放器區域在有歌曲時保持可見（即使暫停播放）
    ensurePlayerSectionVisible() {
        if (this.currentTrack) {
            // 只要有當前歌曲，就顯示播放器區域
            if (this.playerSection.style.display === 'none') {
                this.playerSection.style.display = 'grid';
                this.authSection.style.display = 'none';
                this.noMusicSection.style.display = 'none';
                this.log('🎵 強制顯示播放器區域 - 有當前歌曲');
            }
        }
    }

    // 強化版 Session 保護機制
    protectSession() {
        if (!this.sessionId) return;
        
        // 定期備份 Session ID 到多個位置
        try {
            localStorage.setItem('spotify_session_backup', this.sessionId);
            sessionStorage.setItem('spotify_session_backup', this.sessionId);
            
            // 在內存中也保持引用
            this._sessionIdBackup = this.sessionId;
        } catch (error) {
            this.log(`⚠️ Session 備份失敗: ${error.message}`);
        }
    }

    // Session 恢復機制
    recoverSession() {
        if (this.sessionId) return true;
        
        // 嘗試從多個位置恢復
        const sources = [
            () => localStorage.getItem('spotify_session_id'),
            () => localStorage.getItem('spotify_session_backup'),
            () => sessionStorage.getItem('spotify_session_backup'),
            () => this._sessionIdBackup
        ];
        
        for (const getSession of sources) {
            try {
                const recoveredSession = getSession();
                if (recoveredSession) {
                    this.sessionId = recoveredSession;
                    this.log(`✅ Session 已從備份恢復: ${this.sessionId.substring(0, 8)}...`);
                    this.protectSession();
                    return true;
                }
            } catch (error) {
                this.log(`⚠️ Session 恢復嘗試失敗: ${error.message}`);
            }
        }
        
        return false;
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
                    this.log('ℹ️ checkAuthStatus 沒有 sessionId，顯示登入頁面');
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
                // 重置錯誤計數器
                this.consecutiveAuthErrors = 0;
                
                if (data.sessionId && !this.sessionId) {
                    this.sessionId = data.sessionId;
                    localStorage.setItem('spotify_session_id', this.sessionId);
                    try {
                        localStorage.setItem('spotify_session_data', JSON.stringify({ sessionId: this.sessionId, savedAt: Date.now() }));
                    } catch (e) {}
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
                this.log('❌ 認證狀態無效');
                this.showAuthSection();
                this.showSessionExpiredMessage();
                this.scheduleAutoLogin();
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
                    this.log('ℹ️ 沒有 sessionId，需要重新登入');
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
        
        // 自動觸發自動登入（每次顯示登入畫面都會觸發）
        if (this.autoLoginEnabled) {
            this.log('🚀 回到登入畫面，自動觸發自動登入...');
            // 重置自動登入標記，允許重新嘗試
            this.autoLoginAttempted = false;
            this.lastAutoLoginAttempt = 0; // 允許立即重試
            // 立即觸發自動登入
            setTimeout(() => {
                this.scheduleAutoLogin();
            }, 500); // 縮短延遲以提供更快的響應
        }
    }

    showPlayerSection() {
        this.log('🎪 顯示播放器界面');
        this.authSection.style.display = 'none';
        this.playerSection.style.display = 'grid';
        this.log('🎵 播放器區域已顯示');
        this.noMusicSection.style.display = 'none';
        
        // 檢查播放器界面是否正確顯示
        const playerVisible = this.playerSection.style.display === 'grid';
        const authHidden = this.authSection.style.display === 'none';
        const noMusicHidden = this.noMusicSection.style.display === 'none';
        
        this.log(`📊 界面狀態: player=${playerVisible}, auth=${authHidden}, noMusic=${noMusicHidden}`);
        
        this.updateStatus('spotify', true);
    }

    showNoMusicSection(message = null) {
        this.authSection.style.display = 'none';
        this.log('🚫 隱藏播放器區域 - 顯示無音樂狀態');
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
        
        // 如果接近歌曲結尾，適度加快（每8秒）
        if (this.isNearTrackEnd) {
            newInterval = 8000; // 8秒更新
        }
        // 如果最近有用戶操作，適度加速
        else if (Date.now() - this.lastUserAction < 30000) {
            newInterval = 8000; // 8秒
        }
        // 如果被限速過，大幅延長間隔
        else if (this.rateLimitCount > 0) {
            newInterval = Math.min(this.baseCheckInterval * (1.5 + this.rateLimitCount), 20000); // 最多20秒
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

    // 自動登入定時器 - 每 30 分鐘更新一次 session (降低頻率)
    startAutoLoginTimer() {
        if (!this.autoLoginEnabled) return;
        
        this.autoLoginInterval = setInterval(() => {
            this.log('⏰ 30分鐘 Session 靜默檢查');
            this.performQuietSessionCheck();
        }, 30 * 60 * 1000); // 30 分鐘
        
        this.log('🔄 Session 更新定時器已啟動 (每 30 分鐘檢查一次)');
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
                    try {
                        localStorage.setItem('spotify_session_data', JSON.stringify({ sessionId: this.sessionId, savedAt: Date.now() }));
                    } catch (e) {}
                    this.log(`🔄 Session ID 已更新: ${this.sessionId.substring(0, 8)}...`);
                    if (this.authChannel) {
                        this.authChannel.postMessage({ type: 'session-update', sessionId: this.sessionId });
                    }
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
                headers: { 'X-Session-Id': this.sessionId },
                credentials: 'same-origin'
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
        const now = Date.now();
        // 降低冷卻時間閾值，如果是強制重試或明顯已登出，則忽略冷卻
        const cooldown = 2000; 
        
        // 檢查是否處於明顯的已登出狀態（無 Session ID 且認證區域可見）
        const isClearlyLoggedOut = !this.sessionId || 
                                  (this.authSection && getComputedStyle(this.authSection).display !== 'none');

        if (this.lastAutoLoginAttempt && (now - this.lastAutoLoginAttempt < cooldown)) {
            // 如果明顯已登出，則忽略冷卻，強制重試
            if (isClearlyLoggedOut && (now - this.lastAutoLoginAttempt > 1000)) {
                 this.log('⚠️ 處於已登出狀態，強制重試自動登入...');
            } else {
                this.log('⏭️ 短時間內已嘗試過自動登入，暫時跳過');
                return;
            }
        }
        
        this.lastAutoLoginAttempt = now;
        
        // 立即执行自动登入检查，不延迟
        this.log('🚀 页面载入，立即检查自動登入状态...');
        
        // 立即检查认证状态，不等待
        this.checkAuthStatusAndAutoLogin();
    }
    
    async checkAuthStatusAndAutoLogin() {
        try {
            // 首先尝试从localStorage恢复session
            if (!this.sessionId) {
                const storedSessionId = localStorage.getItem('spotify_session_id');
                if (storedSessionId) {
                    this.sessionId = storedSessionId;
                    this.log(`🔄 从localStorage恢复sessionId: ${this.sessionId.substring(0, 8)}...`);
                }
            }
            
            // 如果有sessionId，验证其有效性
            if (this.sessionId) {
                this.log('🔍 验证现有session状态...');
                const isValid = await this.tryBackgroundRefresh();
                if (isValid) {
                    this.log('✅ Session有效，启动播放器');
                    this.showPlayerSection();
                    this.startTracking();
                    this.startTokenRefreshTimer();
                    return;
                }
            }
            
            // 检查是否在登录页面并需要自动触发登录
            const authSectionVisible = this.authSection && 
                                      getComputedStyle(this.authSection).display !== 'none';
                              
            const playerSectionHidden = this.playerSection && 
                                      getComputedStyle(this.playerSection).display === 'none';
            
            const loginButton = document.querySelector('#login-btn, .login-btn, [href*="auth"]');
            const hasLoginButton = loginButton && getComputedStyle(loginButton).display !== 'none';
            
            this.log(`🔍 页面状态 - 认证区域可见: ${authSectionVisible}, 播放器隐藏: ${playerSectionHidden}, 有登录按钮: ${hasLoginButton}`);
            
            // 如果检测到在登录页面，立即触发登录
            if (authSectionVisible || playerSectionHidden || hasLoginButton) {
                const k = 'auth_redirect_cooldown_until';
                const now = Date.now();
                const until = parseInt(localStorage.getItem(k) || '0', 10);
                const inAuthFlow = window.location.pathname.indexOf('/api/auth') !== -1 || window.location.pathname.indexOf('/callback') !== -1;
                if (!inAuthFlow && (!until || now >= until)) {
                    this.log('🚀 检测到登录页面，立即触发自动登录');
                    // 減少延遲，提供更快的體驗
                    setTimeout(() => {
                        // 縮短冷卻時間至 5 秒，允許更頻繁的重試
                        localStorage.setItem(k, String(Date.now() + 5000));
                        if (loginButton && getComputedStyle(loginButton).display !== 'none') {
                            this.log('🖱️ 自动点击登录按钮');
                            loginButton.click();
                        } else {
                            this.log('🔗 直接跳转到认证页面');
                            window.location.href = '/api/auth';
                        }
                    }, 100);
                } else {
                    const remaining = Math.ceil((until - now) / 1000);
                    this.log(`⏳ 跳过自动登录（冷卻中，剩餘 ${remaining} 秒）`);
                }
            } else {
                this.log('ℹ️ 播放器已运行或状态未知，尝试checkAuthStatus');
                this.checkAuthStatus();
            }
        } catch (error) {
            this.log(`❌ 自动登录检查失败: ${error.message}`);
            // 失败时显示登录页面
            this.showAuthSection();
        }
    }
    
    // 显示session过期提示（不强制跳转）
    showSessionExpiredMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ff9500, #ff6b35);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(255, 149, 0, 0.3);
            z-index: 1000;
            font-weight: 600;
            max-width: 350px;
            line-height: 1.4;
            cursor: pointer;
        `;
        messageDiv.innerHTML = `
            <div style="font-size: 14px; margin-bottom: 8px;">🔐 Session已过期</div>
            <div style="font-size: 12px; opacity: 0.9;">点击这里重新登录 Spotify</div>
        `;
        
        // 点击重新登录
        messageDiv.onclick = () => {
            window.location.href = '/api/auth';
        };
        
        document.body.appendChild(messageDiv);
        
        // 10秒后自动消失
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.style.animation = 'slideIn 0.3s ease reverse';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.parentNode.removeChild(messageDiv);
                    }
                }, 300);
            }
        }, 10000);
    }
    
    // 启动定期的静默session检查
    startPeriodicSessionCheck() {
        // 每5分钟检查一次session状态
        this.sessionCheckInterval = setInterval(async () => {
            if (this.sessionId) {
                this.log('🕐 定期检查session状态...');
                const isValid = await this.tryBackgroundRefresh();
                if (!isValid) {
                    this.log('⚠️ 定期检查发现session过期，但继续静默运行');
                    // 静默处理，不跳转
                    this.consecutiveAuthErrors = 0; // 重置错误计数
                }
            }
        }, 3 * 60 * 1000); // 3分钟，更频繁检查
    }
    
    // 清理定期检查
    stopPeriodicSessionCheck() {
        if (this.sessionCheckInterval) {
            clearInterval(this.sessionCheckInterval);
            this.sessionCheckInterval = null;
        }
    }
    
    // 401错误处理：直接触发自动登录
    async handle401Error() {
        if (this.isHandlingAuthError) return;
        this.isHandlingAuthError = true;
        
        this.log('🔑 檢測到401認證過期，嘗試自動恢復...');
        
        try {
            const success = await this.tryBackgroundRefresh();
            if (success) {
                this.log('✅ 自動恢復成功，恢復正常輪詢');
                this.isHandlingAuthError = false;
                this.consecutiveAuthErrors = 0;
                // 恢復正常輪詢
                this.checkCurrentTrackWithRateLimit();
                return;
            }

            this.log('⚠️ 自動恢復失敗，準備重定向到登入頁面');
            this.consecutiveAuthErrors++;
            
            if (this.consecutiveAuthErrors >= 3) {
                this.log('❌ 連續認證失敗次數過多，停止自動重定向');
                this.showAuthSection();
                this.isHandlingAuthError = false;
                return;
            }

            // 延遲重定向，給用戶一點反應時間
            setTimeout(() => {
                this.log('🚀 執行重定向到 /api/auth');
                window.location.href = '/api/auth';
            }, 2000);
            
        } catch (error) {
            this.log(`❌ 處理 401 錯誤時發生異常: ${error.message}`);
            this.showAuthSection();
        } finally {
            // 注意：重定向會導致頁面重新載入，所以這裡的狀態重置可能不重要
            // 但為了安全起見還是重置
            setTimeout(() => { this.isHandlingAuthError = false; }, 5000);
        }
    }

    // 后台静默刷新session
    async tryBackgroundRefresh() {
        try {
            this.log('🔄 尝试后台静默刷新session...');
            
            // 1. 首先检查认证状态
            try {
                const authResponse = await fetch('/api/auth-status', {
                    method: 'GET',
                    headers: this.sessionId ? { 'X-Session-Id': this.sessionId } : {},
                    credentials: 'same-origin'
                });

                if (authResponse.ok) {
                    const authData = await authResponse.json();
                    if (authData.authenticated) {
                        this.log('✅ session仍然有效');
                        this.consecutiveAuthErrors = 0;
                        return true;
                    } else {
                        this.log('⚠️ session無效，嘗試刷新...');
                    }
                }
            } catch (e) {
                this.log(`⚠️ 檢查認證狀態失敗: ${e.message}`);
            }
            
            // 2. 尝试静默token刷新
            this.log('🔄 尝试静默token刷新...');
            try {
                const refreshResponse = await fetch('/api/refresh-token', {
                    method: 'POST',
                    headers: this.sessionId ? { 'X-Session-Id': this.sessionId } : {},
                    credentials: 'same-origin' // 包含cookies
                });
                
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    if (refreshData.success) {
                        this.log('✅ token刷新成功');
                        if (refreshData.sessionId && refreshData.sessionId !== this.sessionId) {
                            this.sessionId = refreshData.sessionId;
                            localStorage.setItem('spotify_session_id', this.sessionId);
                        }
                        this.consecutiveAuthErrors = 0;
                        return true;
                    }
                } else if (refreshResponse.status === 404) {
                    this.log('⚠️ /api/refresh-token 端点不存在，跳过此方法');
                } else if (refreshResponse.status === 401) {
                    this.log('⚠️ Refresh token也已失效');
                }
            } catch (error) {
                this.log(`⚠️ token刷新请求失败: ${error.message}`);
            }
            
            // 3. 尝试使用现有cookie进行认证
            this.log('🔄 尝试cookie认证...');
            try {
                const cookieAuthResponse = await fetch('/api/current-track', {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                
                if (cookieAuthResponse.ok) {
                    // 如果能成功獲取當前歌曲，說明 cookie 有效
                    const newSessionHeader = cookieAuthResponse.headers.get('X-New-Session-Id');
                    // 或者如果響應正常，我們可以假設 session 有效
                    this.log('✅ cookie认证成功');
                    
                    if (newSessionHeader) {
                        this.sessionId = newSessionHeader;
                        localStorage.setItem('spotify_session_id', this.sessionId);
                    }
                    
                    this.consecutiveAuthErrors = 0;
                    if (this.authChannel) {
                        this.authChannel.postMessage({ type: 'session-update', sessionId: this.sessionId });
                    }
                    return true;
                }
            } catch (e) {
                 this.log(`⚠️ cookie认证嘗試失敗: ${e.message}`);
            }
            
            this.log('❌ 所有后台刷新方法都失败');
            
            // 最后尝试：直接使用现有session强制刷新 (如果 session ID 存在)
            if (this.sessionId) {
                this.log('🔄 最后尝试：强制session刷新...');
                try {
                    const forceRefreshResponse = await fetch('/api/current-track', {
                        method: 'GET',
                        headers: { 'X-Session-Id': this.sessionId },
                        credentials: 'same-origin',
                        cache: 'no-cache'
                    });
                    
                    if (forceRefreshResponse.ok) {
                        this.log('✅ 强制刷新成功，session已恢复');
                        this.consecutiveAuthErrors = 0;
                        return true;
                    }
                } catch (error) {
                    this.log(`❌ 强制刷新也失败: ${error.message}`);
                }
            }
            
            // 真正失败时，不立即清除，让 enhanced-session-manager 处理
            this.log('❌ 無法恢復 Session');
            return false;
        } catch (error) {
            this.log(`❌ 后台刷新异常: ${error.message}`);
            return false;
        }
    }

    // 顯示自動登入提示
    showAutoLoginMessage(customMessage = null) {
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
        // 使用自定义消息或默认消息
        const message = customMessage || '正在自動連接 Spotify...<br><small>即將跳轉到登入頁面</small>';
        messageDiv.innerHTML = `🎵 ${message}`;
        
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
        
        // 在每次 API 調用前嘗試恢復 Session
        if (!this.sessionId) {
            this.log('⚠️ Session ID 丟失，嘗試恢復...');
            if (!this.recoverSession()) {
                this.log('❌ Session 恢復失敗，需要重新登入');
                this.showAuthSection();
                return;
            }
        }
        
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
            
            // 添加超時控制
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${this.apiBase}/api/current-track`, { 
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            // 處理認證錯誤
            if (response.status === 401) {
                this.log('🔑 當前歌曲API遇到401，嘗試自動恢復');
                await this.handle401Error();
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
            // 如果是認證錯誤，立即尝试刷新Session
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                this.log('🔑 檢測到401錯誤，立即嘗試刷新Session...');
                // 静默处理更多次认证错误，给更多恢复机会  
                if (this.consecutiveAuthErrors >= 20) { // 增加到20次，最大程度避免打断
                    this.log('❌ 连续认证失败次数过多，尝试最终的session恢复');
                    // 最后尝试一次后台刷新，失败则自动登录
                    this.tryBackgroundRefresh().then(success => {
                        if (!success) {
                            this.log('⚠️ 所有恢复方法都失败，自动触发重新登录');
                            this.showAutoLoginMessage('认证已失效，正在自动重新登录...');
                            
                            // 延迟2秒后自动跳转登录
                            setTimeout(() => {
                                const authUrl = '/api/auth';
                                this.log(`🔗 自动重定向到登录页面: ${authUrl}`);
                                window.location.href = authUrl;
                            }, 2000);
                        } else {
                            this.consecutiveAuthErrors = 0;
                        }
                    });
                }
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
                        try {
                            localStorage.setItem('spotify_session_data', JSON.stringify({ sessionId: this.sessionId, savedAt: Date.now() }));
                        } catch (e) {}
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
                try {
                    localStorage.setItem('spotify_session_data', JSON.stringify({ sessionId: this.sessionId, savedAt: Date.now() }));
                } catch (e) {}
                
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

    resetLyricsPlayback() {
        this.log('🔄 重置歌詞播放狀態');
        this.currentLyricIndex = 0;
        this._lastScrolledIndex = -1;

        // 取消所有行的 'current'、'upcoming' 和 'past' class
        const lines = this.lyricsContent.querySelectorAll('.lyrics-line');
        lines.forEach(line => {
            line.classList.remove('current', 'upcoming', 'past');
        });

        // 平滑滾動到頂部        this.lyricsContent.scrollTo({ top: 0, behavior: 'smooth' });
        
        // updateLyrics 將在下一個動畫幀中處理正確的高亮
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

        // 先检查是否为新歌曲（在更新 currentTrack 之前）
        const isSameSongNameAndArtist = this.currentTrack && 
                                       this.currentTrack.name === data.name && 
                                       this.currentTrack.artist === data.artist;
                                       
        const isNewTrack = !this.currentTrack || 
                          (this.currentTrack.id !== data.id && !isSameSongNameAndArtist) ||
                          this.currentTrack.name !== data.name;
        
        // 🚨 新增：檢查播放狀態是否從暫停變為播放
        const isResumed = this.currentTrack && !this.currentTrack.isPlaying && data.isPlaying;

        // ✨ 偵測到歌曲重播或跳回開頭 (放寬偵測範圍以應對輪詢延遲)
        const isProgressReset = this.currentTrack && 
                               this.currentTrack.id === data.id && 
                               data.progress < 10000 && // 新進度在歌曲開頭 (10秒內)
                               data.progress < this.currentTrack.progress - 5000; // 且進度大幅回跳 (至少回跳 5 秒)

        this.log(`🔄 歌曲狀態: ${isNewTrack ? '新歌曲' : '相同歌曲'}, 恢復播放: ${isResumed}, 重播: ${isProgressReset}, 同名同歌手: ${isSameSongNameAndArtist}`);

        if (isProgressReset) {
            this.log('🔄 偵測到歌曲循環播放或跳轉到開頭');
            this.resetLyricsPlayback();
        }

        // ✨ 穩定進度處理：防止 API 延遲導致的進度回跳
        let finalProgress = data.progress;
        
        // 🚀 關鍵：偵測來自伺服器的設定變更（用於跨裝置同步）
        if (data.lyricsOffset !== undefined) {
            // 如果伺服器的偏移與本地不同，且當前沒有正在手動調整，則同步
            if (Math.abs(data.lyricsOffset - this.lyricsTimeOffset) > 100) {
                this.log(`🔄 偵測到來自伺服器的偏移變更: ${data.lyricsOffset}ms`);
                this.lyricsTimeOffset = data.lyricsOffset;
                this.updateOffsetDisplay();
                // 重新高亮歌詞以立即應用偏移
                this.updateLyricsHighlight(finalProgress + this.lyricsTimeOffset);
            }
        }

        // 🚀 關鍵：偵測手動歌詞變更（用於跨裝置同步）
        if (data.manualLyrics && (!this.overriddenLyricsSource || this.overriddenLyricsSource.id !== data.manualLyrics.id)) {
            this.log(`🔄 偵測到來自伺服器的手動歌詞變更: ${data.manualLyrics.source}`);
            this.isLyricsOverridden = true;
            this.overriddenLyricsSource = data.manualLyrics;
            // 重新加載歌詞
            this.safeLyricsLoad();
        }

        const previousLyricsVersion = this.currentTrack?.lyricsVersion || 0;
        const incomingLyricsVersion = data.lyricsVersion || 0;
        const customLyricsChanged = !isNewTrack &&
            data.id === this.currentTrack?.id &&
            incomingLyricsVersion &&
            previousLyricsVersion &&
            incomingLyricsVersion !== previousLyricsVersion;

        if (customLyricsChanged) {
            this.log(`🔄 偵測到同帳號自定義歌詞更新: ${previousLyricsVersion} -> ${incomingLyricsVersion}`);
            this.lyrics = [];
            this.currentLyricsTrackId = null;
            this.currentLyricIndex = 0;
            this._lastScrolledIndex = -1;
            this.isLyricsOverridden = false;
            this.isLoadingLyrics = false;
            this.lastLyricsRequest = null;
        }

        // 🚀 延遲補償：如果伺服器提供了數據採樣時的時間戳
        // Store RAW values BEFORE compensation for accurate cross-device timing
        const rawSpotifyProgress = data.progress;
        const rawSpotifyTimestamp = data.timestamp;
        
        if (data.timestamp && data.isPlaying) {
            const latency = Date.now() - data.timestamp;
            if (latency > 0 && latency < 5000) { 
                finalProgress += latency;
                this.log(`⏱️ 延遲補償: ${latency}ms`);
            }
        }

        if (!isNewTrack && data.isPlaying && this.currentTrack) {
            const currentEstimatedTime = (Date.now() - this.currentTrack.lastUpdated) + this.currentTrack.progress;
            const diff = finalProgress - currentEstimatedTime;
            
            // 如果 API 回報的進度與本地估算相差較小，則保留本地估算，避免抖動
            if (Math.abs(diff) < 3000 && !isProgressReset) {
                this.log(`🛡️ 進度微調: ${Math.round(diff)}ms (保留本地估算)`);
                finalProgress = currentEstimatedTime;
            }
        }

        // 更新 currentTrack
        this.currentTrack = {
            ...data,
            progress: finalProgress,
            lastUpdated: Date.now()
        };
        
        // Store raw Spotify timestamp for accurate cross-device timing
        // Use RAW values (before latency compensation) to avoid double-counting
        if (rawSpotifyTimestamp && rawSpotifyProgress !== undefined) {
            this.spotifyProgress = rawSpotifyProgress;
            this.spotifyTimestamp = rawSpotifyTimestamp;
        }
        
        this.log(`🎵 歌曲數據已更新: ${data.name} (進度: ${Math.round(finalProgress)}ms)`);
        
                try {
                    if (data.user_id !== undefined || data.is_premium !== undefined) {
                        const profile = {
                            userId: data.user_id,
                            isPremium: !!data.is_premium,
                            lastUpdated: Date.now()
                        };
                        localStorage.setItem('spotify_user_profile', JSON.stringify(profile));
                    }
                } catch (e) {}
        
                // 触发歌曲切换动画
                if (isNewTrack) {
                    this.triggerSongChangeAnimation();
                    
                    // 廣播歌曲變化給控制台和其他分頁
                    if (this.controlChannel) {
                        this.controlChannel.postMessage({ 
                            type: 'track-sync', 
                            track: this.currentTrack 
                        });
                    }

                    const trackKey = this.currentTrack ? `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}` : null;
                    if (trackKey) {
                        this.lyricsSearchFailedFor.delete(trackKey);
                    }
                }
        
                // 並行獲取下一首歌曲的信息
                this.nextSongData = null;
                
                // ✨ 優化：直接從 data.queue 中獲取下一首歌曲信息，避免額外的 API 請求
                if (data.queue && data.queue.length > 0) {
                    this.nextSongData = data.queue[0];
                    this.log('🎵 已從當前軌道數據中獲取下一首歌曲信息');
                    this.scheduleNextSongPreview();
                } else {
                    // 如果 data 中沒有 queue，再嘗試手動獲取（通常不應該發生）
                    this.fetchNextSongData().then((success) => {
                        if (success) {
                            this.log('🎵 下一首歌曲信息手動加載成功');
                            this.scheduleNextSongPreview();
                        } else {
                            this.log('⏭️ 無法獲取下一首歌曲信息');
                            this.scheduleNextSongPreview();
                        }
                    });
                }
        
                // 如果是始終顯示模式，立即顯示（如果有數據）
                if (this.nextSongPreviewMode === 'always' && this.nextSongData) {
                    this.showNextSongPreview();
                }
                // 重置重試計數器和認證錯誤計數
                this.retryCount = 0;
                this.consecutiveAuthErrors = 0;
                
                // 處理無音樂播放的情況 - 修改邏輯，不要因為暫停就隱藏播放器
                if (!data.name || data.name === null) {
                    this.log('🔍 沒有檢測到歌曲資訊');
                    let message = '請在 Spotify 中開始播放音樂';
                    if (data.message) {
                        this.log(`📝 服務端消息: ${data.message}`);
                        message = data.message;
                    }
                    this.showNoMusicSection(message);
                    return;
                }
                
                // 如果歌曲存在但暫停播放，保持顯示播放器而不是隱藏
                if (!data.isPlaying && data.name) {
                    this.log('⏸️ 歌曲已暫停，但保持顯示播放器');
                    // 繼續處理，不要返回到 no-music 狀態
                }
        
                this.log('✅ 檢測到正在播放的音樂，繼續處理...');
                
                // 檢測內容類型並添加到數據中
                if (!data.contentType) {
                    data.contentType = this.detectContentType(data);
                }
                this.currentContentType = data.contentType;
                this.currentTrack.lastUpdated = Date.now();
                
                // 確保UI始終更新（即使是相同歌曲）
                this.log('🎨 更新播放器UI');
                this.updateTrackInfo();
                this.showPlayerSection();
                
                // 歌词处理逻辑
                if (isNewTrack) {
                    this.log('🎵 新歌曲，重置歌詞狀態並立即清理 UI');
                    this.isLyricsOverridden = false;
                    // 立即清理界面，防止看到上一首
                    this.lyrics = [];
                    this.displayLyrics(); // 這會清空當前列表
                    this.showLyricsPlaceholder('🎵 正在載入新歌詞...');
                    
                    // 重置播放狀態
                    this.currentLyricIndex = 0;
                    this._lastScrolledIndex = -1;
                    this._lastHighlightTime = 0;
                    
                    this.currentLyricsTrackId = null;
                    this.isLoadingLyrics = false;
                    this.lastLyricsRequest = null; // 重置请求记录            
            // 立即隐藏预览并重置状态
            this.isNextSongPreviewShown = false;
            if (this.nextSongPreview) {
                this.nextSongPreview.style.display = 'none';
                this.nextSongPreview.classList.remove('slide-in', 'slide-out');
            }
            
            // 清除预览定时器
            if (this.nextSongPreviewTimeout) {
                clearTimeout(this.nextSongPreviewTimeout);
                this.nextSongPreviewTimeout = null;
            }
            
            // 清除之前的歌詞載入請求
            if (this.lyricsLoadTimeout) {
                clearTimeout(this.lyricsLoadTimeout);
                this.lyricsLoadTimeout = null;
            }
            
            // 使用安全的歌詞載入方法（只調用一次）
            this.safeLyricsLoad();
            
            // 🚨 僅在歌曲變更時檢查是否已按讚
            this.checkIfTrackIsLiked();
        } else {
            this.log('🔄 相同歌曲，確保UI正確顯示');
            // 🚨 如果是從暫停恢復，強制重啟進度追蹤
            if (isResumed) {
                this.log('▶️ 偵測到恢復播放，強制重啟進度追蹤循環');
                this.updateProgress();
            }
            
            // 检查歌词是否需要重新加载
            const hasLyrics = this.lyrics && this.lyrics.length > 0;
            const isIdMatching = this.currentLyricsTrackId === this.currentTrack.id;
            
            // ✨ 增強：如果只是 ID 變了但名字歌手沒變，且已經有歌詞了，就不需要重新載入
            const needsLyricsReload = customLyricsChanged || (!this.isLyricsOverridden && (!hasLyrics || (!isIdMatching && !isSameSongNameAndArtist)));
            
            if (needsLyricsReload) {
                this.log('🎵 需要重新載入歌詞');
                this.currentLyricsTrackId = null; // 强制重置
                this.isLoadingLyrics = false;
                this.safeLyricsLoad();
            }
        }
        
        // 更新下一首預覽（使用一次性獲取的數據）
        this.updateNextTrackPreview();
        
        // 如果正在播放，確保進度追蹤循環正在運行 (針對循環播放或長時間背景運行的修復)
        const isProgressMissing = data.isPlaying && !this.animationFrameId;
        if (isResumed || isNewTrack || isProgressReset || isProgressMissing) {
            this.log(`▶️ 重啟進度追蹤 (原因: ${isResumed ? '恢復' : isNewTrack ? '新歌' : isProgressReset ? '重播' : '補償偵測'})`);
            this.updateProgress();
        }
        
        // 每次都需要更新的內容
        this.updatePlayerControls();
        // 移除這裡的重複呼叫，因為上面已經處理了
        // this.updateProgress(); 
        this.updateStatus('spotify', true);
        
        // 強制確保播放器始終可見（無論播放或暫停）
        this.ensurePlayerSectionVisible();
        
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
    
    // 強制更新UI - 調試用
    forceUpdateUI() {
        this.log('🔧 強制更新UI...');
        this.log(`📊 當前數據: ${this.currentTrack ? `${this.currentTrack.name} - ${this.currentTrack.artist}` : 'null'}`);
        
        if (this.currentTrack) {
            this.showPlayerSection();
            this.updateTrackInfo();
            this.updatePlayerControls();
            this.updateProgress();
            this.log('✅ UI強制更新完成');
        } else {
            this.log('❌ 無當前歌曲數據，無法更新UI');
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
        if (!this.currentTrack) {
            this.log('⚠️ updateTrackInfo: currentTrack 為空');
            return;
        }

        this.log(`🎨 更新歌曲UI: ${this.currentTrack.name} - ${this.currentTrack.artist}`);
        
        // 檢查必要的DOM元素
        if (!this.albumImage || !this.trackName || !this.artistName || !this.albumName) {
            this.log('❌ 關鍵UI元素缺失');
            return;
        }

        this.albumImage.src = this.currentTrack.image || '';
        
        // 根據內容類型調整顯示
        if (this.currentTrack.contentType === 'podcast') {
            this.albumImage.alt = `${this.currentTrack.album} Podcast 封面`;
            // 使用 OpenCC 轉換為繁體中文
            this.trackName.textContent = typeof convertToTraditional === 'function' ? 
                convertToTraditional(this.currentTrack.name) : this.currentTrack.name;
            this.artistName.textContent = `🎙️ ${typeof convertToTraditional === 'function' ? 
                convertToTraditional(this.currentTrack.artist) : this.currentTrack.artist}`;
            this.albumName.textContent = `Podcast: ${typeof convertToTraditional === 'function' ? 
                convertToTraditional(this.currentTrack.album) : this.currentTrack.album}`;
        } else {
            this.albumImage.alt = `${this.currentTrack.album} 專輯封面`;
            // 使用 OpenCC 轉換為繁體中文
            this.trackName.textContent = typeof convertToTraditional === 'function' ? 
                convertToTraditional(this.currentTrack.name) : this.currentTrack.name;
            this.artistName.textContent = typeof convertToTraditional === 'function' ? 
                convertToTraditional(this.currentTrack.artist) : this.currentTrack.artist;
            this.albumName.textContent = typeof convertToTraditional === 'function' ? 
                convertToTraditional(this.currentTrack.album) : this.currentTrack.album;
        }
        
        this.log(`✅ UI 元素已更新 - 歌名: ${this.trackName.textContent}`);
        this.log(`✅ UI 元素已更新 - 藝術家: ${this.artistName.textContent}`);
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
        
        // 移除這裡的 checkIfTrackIsLiked 呼叫，改在 processTrackData 中僅當歌曲變更時呼叫
        // 檢查當前歌曲是否在已按讚的歌曲中
        // this.checkIfTrackIsLiked();
        
        // 更新动画效果
        this.updatePlayButtonAnimation(this.currentTrack.isPlaying);
        this.updateProgressPulse(this.currentTrack.isPlaying);
        this.addAlbumBreathingEffect(!this.currentTrack.isPlaying);
        
        // 更新手機版歌詞控制區域
        if (this.isMobile && this.currentMobilePage === 'lyrics') {
            this.showMobileLyricsControls();
        }
        
        // 移除這裡的 setTimeout 呼叫
        // 立即检查喜欢状态，确保按钮状态同步
        // setTimeout(() => {
        //     this.checkIfTrackIsLiked();
        // }, 200);
    }

    updateProgress() {
        if (!this.currentTrack) return;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.progressClockTimer) {
            clearInterval(this.progressClockTimer);
            this.progressClockTimer = null;
        }

        const update = () => {
            if (!this.currentTrack) {
                this.animationFrameId = null;
                return;
            }

            // 节拍效果已移除

             let elapsedTime;
             if (this.currentTrack.isPlaying) {
                // 使用更精確的計算：(現在時間 - 數據更新時間) + Spotify 報告的進度
                const timeDiff = Date.now() - this.currentTrack.lastUpdated;
                elapsedTime = timeDiff + this.currentTrack.progress;
                
                // 守衛：如果計算出的時間遠大於歌曲長度，鎖定在長度值
                if (elapsedTime > this.currentTrack.duration) {
                    elapsedTime = this.currentTrack.duration;
                }
            } else {
                elapsedTime = this.currentTrack.progress;
            }
            
            // 每秒同步一次進度，防止累積誤差 (除了 requestAnimationFrame 以外的守衛)
            if (this.currentTrack.isPlaying) {
                const progress = (elapsedTime / this.currentTrack.duration) * 100;
                this.progressFill.style.width = `${Math.min(100, progress)}%`;
                this.currentTime.textContent = this.formatTime(elapsedTime);
                this.updateLyricsHighlight(elapsedTime + this.lyricsTimeOffset);
            }

            const remainingTime = this.currentTrack.duration - elapsedTime;
            if (remainingTime <= 5000 && remainingTime > 0 && this.currentTrack.isPlaying) {
                this.showNextTrackPreview();
            }

            // 檢查下一首預覽（每隔1秒檢查一次）
            const now = Date.now();
            if (!this.lastPreviewCheck || now - this.lastPreviewCheck > 1000) {
                this.lastPreviewCheck = now;
                // 使用临时进度值检查预览，不修改原始 progress
                this.scheduleNextSongPreviewWithProgress(elapsedTime);
            }

            if (this.currentTrack.isPlaying && elapsedTime < this.currentTrack.duration) {
                this.animationFrameId = requestAnimationFrame(update);
            } else {
                this.animationFrameId = null;
            }
        };

        update();

        if (this.currentTrack.isPlaying) {
            this.progressClockTimer = setInterval(() => {
                if (!this.currentTrack || !this.currentTrack.isPlaying) return;

                const syncedElapsed = this.spotifyTimestamp > 0 && this.spotifyProgress !== undefined
                    ? this.spotifyProgress + (Date.now() - this.spotifyTimestamp)
                    : (Date.now() - this.currentTrack.lastUpdated) + this.currentTrack.progress;
                const elapsedTime = Math.min(this.currentTrack.duration || syncedElapsed, syncedElapsed);

                this.currentTime.textContent = this.formatTime(elapsedTime);
            }, 1000);
        }
    }

async loadLyrics() {
    if (!this.currentTrack) {
        console.log('ℹ️ 没有当前歌曲，跳过歌词载入');
        return;
    }

    // 如果是 Podcast，显示特殊讯息而不载入歌词
    if (this.currentTrack.contentType === 'podcast') {
        this.showLyricsPlaceholder('🎙️ 正在播放 Podcast\n\n享受精彩的音频内容吧！');
        this.updateStatus('lyrics', true);
        return;
    }

    const trackKey = `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}`;
    console.log(`🎤 请求歌词: ${this.currentTrack.artist} - ${this.currentTrack.name}`);
    
    // 🏆 [Priority 1] 核心優先權：檢查本地儲存與雲端同步 (StorageManager)
    // 包含用戶手動編輯的歌詞，優先權最高
    if (window.lyricsStorageManager) {
        try {
            const savedLyrics = await window.lyricsStorageManager.getUserLyrics(this.currentTrack);
            if (savedLyrics) {
                this.lyrics = savedLyrics.lyrics;
                this.lyricsType = savedLyrics.lyricsType;
                this.currentLyricsTrackId = this.currentTrack.id;
                
                // 載入時間偏移
                const savedOffset = await window.lyricsStorageManager.getLyricsTimeOffset(this.currentTrack);
                this.lyricsTimeOffset = savedOffset || 0;
                this.updateOffsetDisplay();
                
                this.displayLyrics();
                this.updateStatus('lyrics', true);
                console.log(`✅ [Storage] 已加載本地/雲端保存的歌詞: ${savedLyrics.source} (時間偏移: ${this.lyricsTimeOffset}ms)`);
                
                // 如果是預加載命中的，也清理掉預加載緩存
                const currentTrackId = this.currentTrack.id || `${this.currentTrack.name}-${this.currentTrack.artist}`;
                if (this.lastPreloadedTrackId === currentTrackId) {
                    this.nextSongLyrics = null;
                    this.nextSongLyricsType = null;
                }
                
                return; 
            }
        } catch (e) {
            console.warn('讀取儲存歌詞失敗:', e);
        }
    }

    // ⚡ [Priority 2] 預加載命中的歌詞 (API 快取)
    const currentTrackId = this.currentTrack.id || `${this.currentTrack.name}-${this.currentTrack.artist}`;
    if (this.lastPreloadedTrackId === currentTrackId && this.nextSongLyrics && this.nextSongLyrics.length > 0) {
        this.log(`⚡ 使用預加載的 API 歌詞: ${this.currentTrack.name}`);
        this.lyrics = this.nextSongLyrics;
        this.lyricsType = this.nextSongLyricsType;
        this.currentLyricsTrackId = this.currentTrack.id;
        this.displayLyrics();
        this.updateStatus('lyrics', true);
        
        this.nextSongLyrics = null;
        this.nextSongLyricsType = null;
        
        return;
    }
    
    // 🧠 [Priority 3] 記憶體快取 (Memory Cache)
    if (this.lyrics && this.lyrics.length > 0 && 
        this.currentLyricsTrackId === this.currentTrack.id &&
        this.currentLyricsTrackId !== null) {
        console.log('✅ [Memory] 歌詞已在記憶體中，跳過載入');
        return;
    }
    
    // 🌐 [Priority 4] API 加載 (最後手段)
    this.log(`🎤 開始載入歌詞 (API): ${this.currentTrack.name} - ${this.currentTrack.artist}`);

    if (this.isLoadingLyrics) {
        console.log('⏳ 歌词载入中，跳过重复请求');
        return;
    }
    
    if (this.lastLyricsRequest && 
        this.lastLyricsRequest.trackKey === trackKey && 
        Date.now() - this.lastLyricsRequest.time < 2000) {
        console.log('⏳ 最近 2 秒內剛請求過此歌曲，跳過重複請求');
        return;
    }
    
    this.isLoadingLyrics = true;
    const currentLoadingId = this.currentTrack.id;
    this.lastLyricsRequest = {
        trackKey: trackKey,
        time: Date.now()
    };
    
    // 设置载入超时保护
    const loadingTimeout = setTimeout(() => {
        if (this.isLoadingLyrics) {
            this.log('⚠️ 歌词载入超时，重置状态');
            this.isLoadingLyrics = false;
        }
    }, 60000);

    this.updateStatus('lyrics', null);

    try {
        let artist = this.currentTrack.artist;
        let proxyUrl = `/api/lyrics/${encodeURIComponent(artist)}/${encodeURIComponent(this.currentTrack.name)}`;
        let response = await fetch(proxyUrl);
        
        // 🚨 增強：如果 404 且包含多個歌手，嘗試只用第一個歌手
        if (!response.ok && response.status === 404 && artist.includes(',')) {
            const firstArtist = artist.split(',')[0].trim();
            this.log(`⚠️ 完整歌手名 404，嘗試第一個歌手: ${firstArtist}`);
            proxyUrl = `/api/lyrics/${encodeURIComponent(firstArtist)}/${encodeURIComponent(this.currentTrack.name)}`;
            response = await fetch(proxyUrl);
        }
        
        if (!response.ok) {
            throw new Error(`API 响应错误: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 🚨 關鍵校驗：獲取結果後，確認歌曲是否還是同一首
        if (!this.currentTrack || this.currentTrack.id !== currentLoadingId) {
            this.log('⚠️ 歌詞返回時歌曲已換，捨棄結果');
            this.isLoadingLyrics = false;
            clearTimeout(loadingTimeout);
            return;
        }
        
        this.log('歌詞 API 回應成功');
        
        // 🚨 關鍵校驗：獲取結果後，確認歌曲是否還是同一首
        if (!this.currentTrack || this.currentTrack.id !== currentLoadingId) {
            this.log('⚠️ 歌詞返回時歌曲已換，捨棄此結果');
            return;
        }

        // ✨ 優先級保護：如果此時歌詞已經被其他途徑（如預加載或手動搜索）填寫，且 ID 匹配，則不再覆蓋
        if (this.lyrics && this.lyrics.length > 0 && this.currentLyricsTrackId === currentLoadingId) {
            this.log('✅ 歌詞已由其他來源成功載入，保持原樣以確保穩定');
            return;
        }
        
        this.log('歌詞 API 回應:', data);

        if (data.success && data.lyrics && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
            // ✨ 核心優化：標準化與清理歌詞數據
            const sanitizedLyrics = data.lyrics.map(line => {
                let processedLine = { ...line };
                
                // 1. 清理主文本中的標籤 (處理轉義和原始符號)
                if (typeof processedLine.text === 'string') {
                    processedLine.text = processedLine.text.replace(/<[^>]*>/g, '').trim();
                }
                
                // 2. 處理逐字數據 (相容 start/end 或 time/duration)
                if (processedLine.words && Array.isArray(processedLine.words)) {
                    processedLine.words = processedLine.words.map(w => {
                        let word = { ...w };
                        // 統一時間欄位 (有些 API 回傳 start/end 而非 time/duration)
                        if (word.start !== undefined && word.time === undefined) word.time = word.start;
                        if (word.end !== undefined && word.duration === undefined) {
                            word.duration = word.end - (word.start || word.time || 0);
                        }
                        
                        // 清理單個字的標籤
                        if (typeof word.text === 'string') {
                            word.text = word.text.replace(/<[^>]*>/g, '');
                        }
                        return word;
                    });
                    
                    // 如果 text 為空或包含未清理標籤，重新從 words 構建純淨文本
                    if (!processedLine.text || processedLine.text.includes('<') || processedLine.text.includes('\u003C')) {
                        processedLine.text = processedLine.words.map(w => w.text).join('').trim();
                    }
                }
                
                return processedLine;
            });

            const validLyrics = sanitizedLyrics.filter(line => {
                // 安全獲取文本內容
                let text = line.text || '';
                return text && text.trim() !== '' && this.isValidText(text);
            });

            if (validLyrics.length > 0) {
                if (this.currentTrack && this.currentTrack.id) {
                    this.lyrics = validLyrics;
                    this.lyricsType = data.type || 'plain';
                    this.currentLyricsTrackId = this.currentTrack.id;
                    
                    // ✨ 关键：载入保存的歌词（优先级最高）
                    if (window.lyricsStorageManager) {
                        const savedLyrics = await window.lyricsStorageManager
                            .getUserLyrics(this.currentTrack);
                        if (savedLyrics) {
                            this.lyrics = savedLyrics.lyrics;
                            this.lyricsType = savedLyrics.lyricsType;
                            console.log(`✅ 已使用保存的歌词: ${savedLyrics.source}`);
                        }
                        
                        // ✨ 关键：载入保存的时间偏移
                        const savedOffset = await window.lyricsStorageManager
                            .getLyricsTimeOffset(this.currentTrack);
                        this.lyricsTimeOffset = savedOffset || 0;
                        this.updateOffsetDisplay();
                        if (this.lyricsTimeOffset !== 0) {
                            console.log(`✅ 已载入保存的時間偏移: ${this.lyricsTimeOffset}ms`);
                        }
                    }
                    
                    this.displayLyrics();
                    this.updateStatus('lyrics', true);
                    console.log(`✅ 歌词载入成功: ${validLyrics.length} 行 (${this.lyricsType}) 来源: ${data.source}`);
                } else {
                    console.log('⚠️ 歌曲已切换，忽略此歌词响应');
                }
            } else {
                console.log(`⚠️ 歌词内容无效或为乱码`);
                this.showLyricsError('歌词内容格式错误');
            }
                    } else {
                        const errorMsg = data.error || '找不到歌词';
                        console.log(`⚠️ 歌词载入失败: ${errorMsg}`);
                        
                        // ✨ 增強：如果當前已經有歌詞（且歌曲 ID 匹配），則不要顯示錯誤訊息覆蓋它
                        if (this.lyrics && this.lyrics.length > 0 && this.currentLyricsTrackId === currentLoadingId) {
                            this.log('✅ 雖然 API 請求失敗，但已有現成歌詞，保持顯示以確保穩定');
                            return;
                        }
                        
                        // 記錄失敗，防止重試
                        const trackKey = this.currentTrack ? `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}` : null;
                        if (trackKey) {
                            this.lyricsSearchFailedFor.add(trackKey);
                        }
                        
                        this.showLyricsError(errorMsg);
                    }
                } catch (error) {
                    console.error('载入歌词失败:', error);
                    
                    // ✨ 增強：如果已經有歌詞，不要用錯誤訊息覆蓋它
                    if (this.lyrics && this.lyrics.length > 0 && this.currentLyricsTrackId === currentLoadingId) {
                        this.log('✅ 雖然發生例外，但已有現成歌詞，保持顯示');
                        return;
                    }
                    
                    // 記錄失敗，防止重試
                    const trackKey = this.currentTrack ? `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}` : null;
                    if (trackKey) {
                        this.lyricsSearchFailedFor.add(trackKey);
                    }
                    
                    this.showLyricsError('载入歌词失败: ' + error.message);
                } finally {
        clearTimeout(loadingTimeout);
        this.isLoadingLyrics = false;
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

    // ✨ 新增：全局歌詞數據標準化工具
    standardizeLyrics(lyrics) {
        if (!Array.isArray(lyrics)) return [];
        
        return lyrics.map(line => {
            let processedLine = { ...line };
            
            // 1. 強力清洗文本中的所有標籤 (含 unicode 轉義)
            if (typeof processedLine.text === 'string') {
                processedLine.text = processedLine.text
                    .replace(/\\u003C/g, '<')
                    .replace(/\\u003E/g, '>')
                    .replace(/<[^>]*>/g, '')
                    .trim();
            }
            
            // 2. 標準化逐字數據
            if (processedLine.words && Array.isArray(processedLine.words)) {
                processedLine.words = processedLine.words.map(w => {
                    let word = { ...w };
                    // 映射 start/end -> time/duration
                    if (word.start !== undefined && word.time === undefined) {
                        word.time = word.start;
                    }
                    if (word.end !== undefined && word.duration === undefined) {
                        word.duration = word.end - (word.start || word.time || 0);
                    }
                    // 清洗字詞文本
                    if (typeof word.text === 'string') {
                        word.text = word.text
                            .replace(/\\u003C/g, '<')
                            .replace(/\\u003E/g, '>')
                            .replace(/<[^>]*>/g, '');
                    }
                    return word;
                });
                
                // 如果文字欄位異常，重新構建文字
                if (!processedLine.text || processedLine.text.includes('<')) {
                    processedLine.text = processedLine.words.map(w => w.text).join('').trim();
                }
            }
            
            return processedLine;
        });
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

        // 重置滾動索引，避免新歌詞時出現舊的滾動位置
        this._lastScrolledIndex = -1;

        // ? 新的合並邏輯：統一接納列表或字符串
        this.lyrics = this.standardizeLyrics(this.lyrics);

        const lyricsHTML = this.lyrics.map((line, index) => {
            let lineContent = '';
            
            if (line.words && line.words.length > 0) {
                // 渲染逐字歌詞
                lineContent = line.words.map(w => {
                    let text = w.text;
                    try {
                        if (typeof convertToTraditional === 'function') {
                            text = convertToTraditional(text);
                        }
                    } catch (e) {}
                    // 添加 duration 屬性，默認為 0
                    const duration = w.duration || 0;
                    return `<span class="lyric-word" data-time="${w.time}" data-duration="${duration}">${this.escapeHtml(text)}</span>`;
                }).join('');
            } else {
                // 普通行歌詞
                let text = this.lyricsType === 'synced' ? line.text : (line.text || line);
                try {
                    if (typeof convertToTraditional === 'function') {
                        text = convertToTraditional(text);
                    }
                } catch (err) {
                    console.warn('繁體轉換失敗:', err);
                }
                lineContent = this.escapeHtml(text);
            }

            const timeAttr = this.lyricsType === 'synced' && line.time ? `data-time="${line.time}"` : '';
            return `<div class="lyrics-line" data-index="${index}" ${timeAttr}>${lineContent}</div>`;
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

        // 初始化上一幀時間，用於防抖
        if (this._lastHighlightTime === undefined) {
            this._lastHighlightTime = 0;
        }

        let targetIndex = -1;

        if (currentTime !== undefined) {
            // 檢測是否為 Seek 操作 (時間跳變超過 3秒，放寬閾值以增加穩定性)
            const isSeek = Math.abs(currentTime - this._lastHighlightTime) > 3000;
            
            this._lastHighlightTime = currentTime;

            if (this.lyricsType === 'synced') {
                // 更加穩定的同步邏輯：尋找最後一行時間小於等於當前時間的歌詞
                targetIndex = this.currentLyricIndex !== undefined ? this.currentLyricIndex : -1;
                
                // 只有當前時間大於第一句歌詞時間才開始匹配
                if (currentTime >= (this.lyrics[0]?.time || 0)) {
                    // 從當前索引開始向後找，優化性能
                    let searchStartIndex = Math.max(0, targetIndex);
                    // 如果 Seek 了，或者時間倒退了 (例如重播)，從頭開始找
                    if (isSeek || currentTime < (this.lyrics[targetIndex]?.time || 0)) {
                        searchStartIndex = 0;
                        targetIndex = -1;
                    }

                    // 遍歷尋找最佳匹配
                    for (let i = searchStartIndex; i < this.lyrics.length; i++) {
                        const line = this.lyrics[i];
                        const nextLine = this.lyrics[i + 1];
                        
                        // 匹配條件：當前行時間 <= currentTime < 下一行時間 (或沒有下一行)
                        // 給予 200ms 的提前量，讓顯示更自然
                        if (line.time !== undefined && line.time <= currentTime + 200) {
                            if (!nextLine || !nextLine.time || nextLine.time > currentTime + 200) {
                                targetIndex = i;
                                break;
                            }
                        }
                    }
                } else {
                    // 時間還沒到第一句
                    targetIndex = -1;
                }
                
            } else {
                // 普通歌詞的時間估算邏輯 - 優化：過濾掉空行以獲得更準確的估算
                if (this.currentTrack && this.currentTrack.duration > 0) {
                    const timeOffset = 500; 
                    const adjustedProgress = Math.max(0, (currentTime - timeOffset) / this.currentTrack.duration);
                    
                    // 過濾出有內容的行進行計算
                    const validLines = this.lyrics.map((l, i) => ({ text: (l.text || l), index: i }))
                                              .filter(l => typeof l.text === 'string' && l.text.trim().length > 0);
                    
                    if (validLines.length > 0) {
                        const validIndex = Math.floor(adjustedProgress * validLines.length);
                        const clampedValidIndex = Math.max(0, Math.min(validIndex, validLines.length - 1));
                        targetIndex = validLines[clampedValidIndex].index;
                    } else {
                        targetIndex = Math.floor(adjustedProgress * this.lyrics.length);
                        targetIndex = Math.max(0, Math.min(targetIndex, this.lyrics.length - 1));
                    }
                }
            }
            
            // 只有當索引真正改變時才更新，減少 DOM 操作
            // 注意：不論 autoScroll 是否開啟，都應該更新索引以維持高亮同步
            if (this.currentLyricIndex !== targetIndex) {
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
                
                // 逐字歌詞高亮與填充邏輯
                const words = currentLine.querySelectorAll('.lyric-word');
                if (words.length > 0) {
                    words.forEach(word => {
                        const wordTime = parseInt(word.dataset.time);
                        const duration = parseInt(word.dataset.duration) || 0;
                        
                        if (currentTime >= wordTime) {
                            word.classList.add('active');
                            
                            // 計算填充百分比
                            if (duration > 0) {
                                const elapsed = currentTime - wordTime;
                                const percentage = Math.min(100, Math.max(0, (elapsed / duration) * 100));
                                word.style.setProperty('--word-progress', `${percentage}%`);
                                
                                // 如果完全填充，添加 finished 類 (可選)
                                if (percentage >= 100) {
                                    word.classList.add('finished');
                                } else {
                                    word.classList.remove('finished');
                                }
                            } else {
                                // 如果沒有持續時間，直接設為 100%
                                word.style.setProperty('--word-progress', '100%');
                                word.classList.add('finished');
                            }
                        } else {
                            word.classList.remove('active', 'finished');
                            word.style.setProperty('--word-progress', '0%');
                        }
                    });
                }
                
                if (this.autoScroll && this.currentLyricIndex !== this._lastScrolledIndex) {
                    // 只有當歌詞行真正改變時才滾動，避免重複滾動導致跳動
                    this._lastScrolledIndex = this.currentLyricIndex;
                    
                    // 清除之前的滾動定時器
                    if (this._scrollTimeout) {
                        clearTimeout(this._scrollTimeout);
                    }
                    
                    // 使用防抖延遲滾動，避免頻繁滾動導致的抖動
                    this._scrollTimeout = setTimeout(() => {
                        try {
                            if (currentLine && this.lyricsContent.contains(currentLine)) {
                                currentLine.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'center',
                                    inline: 'nearest'
                                });
                            }
                        } catch (e) {
                            // 忽略滾動錯誤
                        }
                        this._scrollTimeout = null;
                    }, 50); // 50ms 防抖延遲
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

    // 打開設置模態框
    openSettingsModal() {
        if (!this.settingsModal) return;
        
        // 從 localStorage 載入當前設置
        const currentLanguage = localStorage.getItem('app_language') || 'zh-TW';
        const currentTheme = localStorage.getItem('app_theme') || 'dark';
        
        if (this.languageSelect) {
            this.languageSelect.value = currentLanguage;
        }
        if (this.themeSelect) {
            this.themeSelect.value = currentTheme;
        }
        
        this.settingsModal.style.display = 'flex';
        this.log('⚙️ 設置模態框已打開');
    }

    // 關閉設置模態框
    closeSettingsModal() {
        if (!this.settingsModal) return;
        this.settingsModal.style.display = 'none';
        this.log('⚙️ 設置模態框已關閉');
    }

    // 保存設置
    saveSettings() {
        const language = this.languageSelect?.value || 'zh-TW';
        const theme = this.themeSelect?.value || 'dark';
        
        // 保存到 localStorage
        localStorage.setItem('app_language', language);
        localStorage.setItem('app_theme', theme);
        
        this.log(`✅ 設置已保存 - 語言：${language}, 主題：${theme}`);
        
        // 應用主題 - 使用 ThemeManager
        if (typeof ThemeManager !== 'undefined' && ThemeManager.setTheme) {
            ThemeManager.setTheme(theme);
        } else {
            this.applyTheme(theme);
        }
        
        // 如果語言改變，可以執行額外邏輯
        if (language !== (localStorage.getItem('current_language') || 'zh-TW')) {
            this.loadLanguage(language);
        }
        
        // 關閉模態框
        this.closeSettingsModal();
        
        // 顯示提示
        this.showToast('設置已保存');
    }

    // 應用主題
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        this.log(`🎨 主題已應用：${theme}`);
    }

    // 加載語言
    async loadLanguage(lang) {
        try {
            localStorage.setItem('current_language', lang);
            // 這裡可以添加實際的語言包加載邏輯
            this.log(`🌐 語言已切換：${lang}`);
            // 重新翻譯頁面元素
            if (typeof this.translatePage === 'function') {
                this.translatePage();
            }
        } catch (error) {
            this.log(`❌ 加載語言失敗：${error.message}`);
        }
    }

    // 顯示提示消息
    showToast(message, duration = 2000) {
        // 檢查是否已有 toast 元素
        let toast = document.getElementById('toast-message');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-message';
            toast.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                z-index: 10000;
                display: none;
                font-size: 14px;
            `;
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.style.display = 'block';
        
        setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    }

    // 调整歌词时间偏移
adjustLyricsOffset(offset) {
    this.lyricsTimeOffset += offset;
    this.showOffsetMessage();
    console.log(`⏰ 歌词时间偏移: ${this.lyricsTimeOffset}ms`);
    
    // 廣播到其他分頁
    if (this.controlChannel) {
        this.controlChannel.postMessage({ 
            type: 'control-sync', 
            lyricsOffset: this.lyricsTimeOffset 
        });
    }

    // ✨ 关键修复：立即保存时间偏移
    if (this.currentTrack && window.lyricsStorageManager) {
        window.lyricsStorageManager.saveLyricsTimeOffset(
            this.currentTrack, 
            this.lyricsTimeOffset
        );
    }
}

// 重置歌词时间偏移
resetLyricsOffset() {
    this.lyricsTimeOffset = 0;
    this.showOffsetMessage();
    console.log('⏰ 歌词时间偏移已重置');
    
    // 廣播到其他分頁
    if (this.controlChannel) {
        this.controlChannel.postMessage({ 
            type: 'control-sync', 
            lyricsOffset: 0 
        });
    }

    // ✨ 关键修复：保存重置状态
    if (this.currentTrack && window.lyricsStorageManager) {
        window.lyricsStorageManager.saveLyricsTimeOffset(
            this.currentTrack, 
            0
        );
    }
}

// 更新偏移顯示
updateOffsetDisplay() {
    const offsetDisplay = document.getElementById('lyrics-offset-display');
    if (offsetDisplay) {
        const sign = this.lyricsTimeOffset > 0 ? '+' : '';
        offsetDisplay.textContent = `${sign}${(this.lyricsTimeOffset/1000).toFixed(1)}s`;
        offsetDisplay.style.color = this.lyricsTimeOffset !== 0 ? 'var(--primary-color)' : '';
    }
}

// 显示偏移调整提示
showOffsetMessage() {
    this.updateOffsetDisplay();

    const message = this.lyricsTimeOffset === 0 
        ? '⏰ 歌詞時間已重置' 
        : `⏰ 歌詞${this.lyricsTimeOffset > 0 ? '延後' : '提前'} ${Math.abs(this.lyricsTimeOffset/1000).toFixed(1)} 秒`;
    
    this.showSuccessMessage(message);
}

    // 手機頁面切換
    switchMobilePage(page) {
        if (!this.isMobile) return;
        
        this.currentMobilePage = page;
        document.body.classList.toggle('mobile-lyrics-active', page === 'lyrics');
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
            document.body.classList.remove('mobile-lyrics-active');
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
        // 新版 FAB 觸發邏輯
        const mobileToggle = document.getElementById('mobile-lyrics-toggle-btn');
        if (mobileToggle) {
            mobileToggle.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止冒泡
                const controls = document.querySelector('.lyrics-controls');
                if (controls) {
                    controls.classList.toggle('mobile-visible');
                    
                    // 切換按鈕圖標
                    const isVisible = controls.classList.contains('mobile-visible');
                    mobileToggle.innerHTML = isVisible ? '✕' : '⚙️';
                    
                    // 如果顯示了，點擊其他地方可以關閉
                    if (isVisible) {
                        const closeHandler = (ev) => {
                            if (!controls.contains(ev.target) && ev.target !== mobileToggle) {
                                controls.classList.remove('mobile-visible');
                                mobileToggle.innerHTML = '⚙️';
                                document.removeEventListener('click', closeHandler);
                            }
                        };
                        // 延遲添加監聽器，避免立即觸發
                        setTimeout(() => {
                            document.addEventListener('click', closeHandler);
                        }, 100);
                    }
                }
            });
            
            // 點擊控制按鈕後（如果不是 toggle 類型的），可以在操作後自動關閉（可選）
            // 這裡暫不自動關閉，因為用戶可能想連續操作（如調整時間）
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

    // 分享歌曲連結
    copySongLink() {
        if (!this.currentTrack || !this.currentTrack.id) {
            this.showErrorMessage('沒有正在播放的歌曲');
            return;
        }

        const songLink = `https://open.spotify.com/track/${this.currentTrack.id}`;
        
        // 優先使用 navigator.clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(songLink)
                .then(() => {
                    this.showSuccessMessage('✅ 歌曲連結已複製到剪貼簿');
                })
                .catch(err => {
                    this.fallbackCopyTextToClipboard(songLink);
                });
        } else {
            this.fallbackCopyTextToClipboard(songLink);
        }
    }

    fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                this.showSuccessMessage('✅ 歌曲連結已複製到剪貼簿');
            } else {
                this.showErrorMessage('無法複製連結，請手動複製');
            }
        } catch (err) {
            this.showErrorMessage('無法複製連結，請手動複製');
        }

        document.body.removeChild(textArea);
    }

    // 顯示用戶播放清單模態框
    async showUserPlaylistsModal() {
        if (!this.currentTrack) {
            this.showErrorMessage('沒有正在播放的歌曲');
            return;
        }

        this.userPlaylistsModal.style.display = 'flex';
        this.userPlaylistsContent.innerHTML = '<div class="loading">載入播放清單中...</div>';

        try {
            const response = await fetch('/api/playlists', {
                headers: { 'X-Session-Id': this.sessionId }
            });

            if (response.ok) {
                const data = await response.json();
                // 只顯示有權限編輯的播放清單
                const editablePlaylists = data.playlists.filter(p => p.canEdit);
                
                if (editablePlaylists.length === 0) {
                    if (data.playlists.length > 0) {
                        this.userPlaylistsContent.innerHTML = '<div class="loading">您目前沒有可編輯的播放清單<br><small>(僅顯示您擁有的或協作歌單)</small></div>';
                    } else {
                        this.userPlaylistsContent.innerHTML = '<div class="loading">您目前沒有任何播放清單</div>';
                    }
                    return;
                }

                // 檢查目前歌曲是否在這些歌單中（並行檢查前 30 個以保證效能）
                const playlistsWithStatus = await Promise.all(editablePlaylists.slice(0, 30).map(async p => {
                    try {
                        const checkRes = await fetch(`/api/playlists/${p.id}/tracks/${this.currentTrack.id}`, {
                            headers: { 'X-Session-Id': this.sessionId }
                        });
                        const checkData = await checkRes.json();
                        return { ...p, isInPlaylist: checkData.isInPlaylist };
                    } catch (e) {
                        return { ...p, isInPlaylist: false };
                    }
                }));

                this.displayUserPlaylists(playlistsWithStatus);
            } else {
                this.userPlaylistsContent.innerHTML = '<div class="error">無法載入播放清單</div>';
            }
        } catch (error) {
            this.userPlaylistsContent.innerHTML = '<div class="error">載入失敗，請重試</div>';
        }
    }

    // 顯示用戶播放清單
    displayUserPlaylists(playlists) {
        const html = playlists.map(playlist => `
            <div class="playlist-item ${playlist.isInPlaylist ? 'current' : ''}" data-playlist-id="${playlist.id}">
                <img src="${playlist.image || 'https://via.placeholder.com/50'}" class="playlist-item-img">
                <div class="playlist-item-info">
                    <div class="playlist-item-title">${this.escapeHtml(playlist.name)}</div>
                    <div class="playlist-item-tracks">${playlist.tracks} 首歌曲</div>
                </div>
                <div class="playlist-item-actions">
                    <button class="playlist-action-btn toggle-btn ${playlist.isInPlaylist ? 'liked' : ''}" 
                            title="${playlist.isInPlaylist ? '從此歌單移除' : '加入此歌單'}">
                        ${playlist.isInPlaylist ? '➖' : '➕'}
                    </button>
                </div>
            </div>
        `).join('');

        this.userPlaylistsContent.innerHTML = html;

        // 綁定按鈕事件
        this.userPlaylistsContent.querySelectorAll('.playlist-item').forEach(item => {
            const playlistId = item.dataset.playlistId;
            const playlistName = item.querySelector('.playlist-item-title').textContent;
            const toggleBtn = item.querySelector('.toggle-btn');
            const isInPlaylist = toggleBtn.classList.contains('liked');

            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                const action = isInPlaylist ? 'remove' : 'add';
                this.modifyPlaylist(playlistId, playlistName, action);
            };
            
            // 點擊整個項目也可以觸發
            item.onclick = () => {
                const action = isInPlaylist ? 'remove' : 'add';
                this.modifyPlaylist(playlistId, playlistName, action);
            };
        });
    }

    // 修改播放清單（新增/移除歌曲）
    async modifyPlaylist(playlistId, playlistName, action) {
        const trackId = this.currentTrack.id;
        const method = action === 'add' ? 'POST' : 'DELETE';
        const actionText = action === 'add' ? '加入' : '移除';

        try {
            const response = await fetch(`/api/playlists/${playlistId}/tracks`, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({ trackId })
            });

            if (response.ok) {
                this.showSuccessMessage(`✅ 已將歌曲從「${playlistName}」中${actionText}`);
                // 更新播放清單內容（延遲一下讓 Spotify API 同步）
                setTimeout(() => this.showUserPlaylistsModal(), 500);
            } else {
                const data = await response.json();
                this.showErrorMessage(`❌ ${actionText}失敗: ${data.error || '未知錯誤'}`);
            }
        } catch (error) {
            this.showErrorMessage(`❌ ${actionText}失敗，請檢查網路連線`);
        }
    }

    // 顯示歌詞匯出選項模態框
    showExportLyricsOptionsModal() {
        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('目前沒有可匯出的歌詞');
            return;
        }

        // 檢查是否有逐字歌詞數據
        const hasSyllabic = this.lyrics.some(line => line.words && line.words.length > 0);
        
        if (hasSyllabic) {
            this.exportLyricsOptionsModal.style.display = 'flex';
        } else {
            // 如果沒有逐字數據，直接匯出標準 LRC
            this.exportLyrics('lrc');
        }
    }

    // 匯出歌詞
    exportLyrics(type) {
        if (!this.lyrics || this.lyrics.length === 0) return;

        const trackInfo = this.currentTrack;
        const baseName = trackInfo ? `${trackInfo.artist} - ${trackInfo.name}` : 'lyrics';
        let filename, content;

        if (type === 'syllabic') {
            filename = `${baseName}_syllabic.lrc`;
            content = this.generateSyllabicLrc();
        } else {
            filename = `${baseName}.lrc`;
            content = this.generateStandardLrc();
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showSuccessMessage(`✅ 歌詞已匯出: ${filename}`);
    }

    // 生成逐字歌詞 LRC 格式
    generateSyllabicLrc() {
        let lrc = '';
        this.lyrics.forEach(line => {
            if (line.time !== undefined) {
                const timeStr = this.formatLrcTime(line.time);
                let lineText = '';
                
                if (line.words && line.words.length > 0) {
                    lineText = line.words.map(w => {
                        const wordTime = this.formatLrcTime(w.time);
                        return `<${wordTime}>${w.text}`;
                    }).join(' ');
                } else {
                    lineText = line.text;
                }
                
                lrc += `[${timeStr}]${lineText}\n`;
            } else {
                lrc += `${line.text || line}\n`;
            }
        });
        return lrc;
    }

    // 生成標準 LRC 格式
    generateStandardLrc() {
        let lrc = '';
        this.lyrics.forEach(line => {
            if (line.time !== undefined) {
                const timeStr = this.formatLrcTime(line.time);
                lrc += `[${timeStr}]${line.text}\n`;
            } else {
                lrc += `${line.text || line}\n`;
            }
        });
        return lrc;
    }

    // 格式化 LRC 時間 [mm:ss.xx]
    formatLrcTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const centiseconds = Math.floor((ms % 1000) / 10);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
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
                // 1. 提取所有 [mm:ss.xx] 標籤及其後的文本
                const wordLevelRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]([^\[]*)/g;
                const tagWordRegex = /<(\d+),(\d+),\d+>([^<]*)/g;
                let matches = [];
                let match;
                
                while ((match = wordLevelRegex.exec(trimmedLine)) !== null) {
                    const mins = parseInt(match[1]);
                    const secs = parseInt(match[2]);
                    const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
                    const time = (mins * 60 + secs) * 1000 + ms;
                    const text = match[4]; 
                    matches.push({ time, text });
                }

                // 2. 處理解析結果
                if (matches.length === 0 && tagWordRegex.test(trimmedLine)) {
                    // 特殊情況：行首無 [time] 但包含 <off,dur,0> 標籤
                    let allWords = [];
                    tagWordRegex.lastIndex = 0;
                    while ((match = tagWordRegex.exec(trimmedLine)) !== null) {
                        allWords.push({
                            time: parseInt(match[1]),
                            duration: parseInt(match[2]),
                            text: match[3]
                        });
                    }
                    if (allWords.length > 0) {
                        hasTimeStamps = true;
                        lyrics.push({
                            time: allWords[0].time,
                            text: allWords.map(w => w.text).join('').trim(),
                            words: allWords,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                        successfulParses++;
                        continue;
                    }
                }

                if (matches.length > 0) {
                    hasTimeStamps = true;
                    
                    // 檢查是否包含逐字標籤 <off,dur,0>
                    if (tagWordRegex.test(trimmedLine)) {
                        const lineStartTime = matches[0].time;
                        let allWords = [];
                        
                        matches.forEach(m => {
                            let subMatch;
                            let foundSubInBlock = false;
                            tagWordRegex.lastIndex = 0;
                            while ((subMatch = tagWordRegex.exec(m.text)) !== null) {
                                allWords.push({
                                    time: m.time + parseInt(subMatch[1]),
                                    duration: parseInt(subMatch[2]),
                                    text: subMatch[3]
                                });
                                foundSubInBlock = true;
                            }
                            // 如果該區塊沒有 <...> 標籤但有文字，當作普通片段
                            if (!foundSubInBlock && m.text.trim()) {
                                allWords.push({
                                    time: m.time,
                                    text: m.text,
                                    duration: 500
                                });
                            }
                        });

                        if (allWords.length > 0) {
                            lyrics.push({
                                time: lineStartTime,
                                text: allWords.map(w => w.text).join('').trim(),
                                words: allWords,
                                originalLine: line,
                                lineNumber: i + 1
                            });
                            successfulParses++;
                            continue;
                        }
                    }

                    // 處理標準逐字格式 [time]A[time]B
                    if (matches.length > 1) {
                        const lineStartTime = matches[0].time;
                        const words = matches.map((m, idx) => {
                            const nextTime = matches[idx + 1] ? matches[idx + 1].time : m.time + 500;
                            return {
                                time: m.time,
                                text: m.text,
                                duration: Math.max(0, nextTime - m.time)
                            };
                        });

                        lyrics.push({
                            time: lineStartTime,
                            text: matches.map(m => m.text).join('').trim(),
                            words: words,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                    } else {
                        // 普通單時間戳行 (清理可能殘留的標籤)
                        const entry = matches[0];
                        const cleanText = entry.text.replace(/<[^>]*>/g, '').trim();
                        if (cleanText.length > 0) {
                            lyrics.push({
                                time: entry.time,
                                text: cleanText,
                                originalLine: line,
                                lineNumber: i + 1
                            });
                        }
                    }
                    successfulParses++;
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
    async handlePlayPause() {
        this.log('🎮 播放/暫停按鈕被點擊');
        
        if (!this.currentTrack || !this.sessionId) {
            this.log('⚠️ 沒有當前歌曲或會話，無法執行播放/暫停操作');
            return;
        }
        
        // 立即更新按鈕狀態和UI，不等API回應
        const currentIsPlaying = this.currentTrack.isPlaying;
        const newPlayingState = !currentIsPlaying;
        
        // 立即更新本地狀態和UI
        this.currentTrack.isPlaying = newPlayingState;
        this.updatePlayButtonState(newPlayingState);
        this.log(`🎮 本地播放狀態已更新: ${newPlayingState ? '播放' : '暫停'}`);
        
        // 確保專輯背景容器和播放器區域保持可見
        this.ensureAlbumBackgroundVisible();
        this.ensurePlayerSectionVisible();

        // 發送API請求
        try {
            const endpoint = currentIsPlaying ? '/api/player/pause' : '/api/player/play';
            const response = await fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                }
            });

            if (!response.ok) {
                // 如果API調用失敗，還原本地狀態
                this.currentTrack.isPlaying = currentIsPlaying;
                this.updatePlayButtonState(currentIsPlaying);
                this.log(`❌ 播放/暫停API調用失敗，狀態已還原`);
            } else {
                this.log(`✅ 播放/暫停API調用成功`);
            }
        } catch (error) {
            // 如果發生錯誤，還原本地狀態
            this.currentTrack.isPlaying = currentIsPlaying;
            this.updatePlayButtonState(currentIsPlaying);
            this.log(`❌ 播放/暫停操作失敗: ${error.message}，狀態已還原`);
        }
        
        // 不要立即檢查當前歌曲，避免過度調用API
        // this.checkCurrentTrackWithRateLimit();
        
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
                
                // 廣播播放狀態給控制台和其他分頁
                if (this.controlChannel && this.currentTrack) {
                    this.controlChannel.postMessage({ 
                        type: 'playback-sync', 
                        isPlaying: this.currentTrack.isPlaying,
                        lastProgress: this.currentTrack.progress,
                        timestamp: Date.now()
                    });
                }

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
            const checkResponse = await fetch(`/api/library/check/${this.currentTrack.id}`, {
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
            
            const response = await fetch(endpoint, {
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
        this.log(`🧬 調用 safeLyricsLoad, isLoadingLyrics: ${this.isLoadingLyrics}, hasTimeout: ${!!this.lyricsLoadTimeout}`);
        
        // 清除之前的載入請求
        if (this.lyricsLoadTimeout) {
            clearTimeout(this.lyricsLoadTimeout);
            this.log('🔄 清除之前的延遲歌詞載入請求');
        }
        
        // 如果已經在載入中，直接返回
        if (this.isLoadingLyrics) {
            this.log('⏳ 歌詞載入中，忽略新的載入請求');
            return;
        }
        
        // 檢查是否最近剛請求過 (縮短到 2 秒，且只在 trackKey 相同時)
        const trackKey = this.currentTrack ? `${this.currentTrack.id}-${this.currentTrack.name}-${this.currentTrack.artist}` : null;
        
        // 如果之前已確認此歌曲無歌詞，跳過
        if (trackKey && this.lyricsSearchFailedFor.has(trackKey)) {
            this.log(`🚫 之前已確認此歌曲無歌詞，跳過請求: ${trackKey}`);
            return;
        }

        if (this.lastLyricsRequest && 
            this.lastLyricsRequest.trackKey === trackKey && 
            Date.now() - this.lastLyricsRequest.time < 2000) {
            this.log('⏳ 最近 2 秒內剛請求過此歌曲，跳過重複請求');
            return;
        }
        
        // 如果是新歌曲 (this.currentLyricsTrackId 為空)，我們應該降低延遲
        const isNewForLyrics = this.currentLyricsTrackId !== (this.currentTrack ? this.currentTrack.id : null);
        const delay = isNewForLyrics ? 300 : 800; 
        
        this.log(`⏰ 安排在 ${delay}ms 後載入歌詞 (是否為新歌: ${isNewForLyrics})`);
        this.lyricsLoadTimeout = setTimeout(() => {
            if (this.currentTrack && !this.isLoadingLyrics) {
                this.log('🚀 執行延遲的歌詞載入');
                this.loadLyrics();
            } else {
                this.log('⏸️ 跳過歌詞載入：歌曲可能已切換或正在載入中');
            }
            this.lyricsLoadTimeout = null;
        }, delay);
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
            // 確保背景容器在設置背景後保持可見
            bgContainer.style.display = 'block';
            bgContainer.style.visibility = 'visible';
            this.log(`🖼️ 已設置專輯背景圖片: ${this.currentTrack.image}`);
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
                this.log('🔑 Queue API遇到401，直接觸發自動登入');
                await this.handle401Error();
                return;
            }
            
            if (response.ok) {
                const data = await response.json();
                
                // 🚨 立即調試：檢查API回應數據
                console.log('🔥 API回應原始數據:', data);
                console.log('🔥 Queue數據檢查:', {
                    hasQueue: !!data.queue,
                    queueLength: data.queue?.length,
                    queueType: typeof data.queue,
                    isArray: Array.isArray(data.queue),
                    firstTrack: data.queue?.[0]
                });
                
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

    // 執行靜默 Session 檢查（降低頻率，不顯示動畫）
    async performQuietSessionCheck() {
        if (!this.sessionId) {
            this.log('⚠️ 沒有 sessionId，跳過靜默檢查');
            return;
        }
        
        try {
            // 靜默檢查，不顯示任何UI變化
            const authResponse = await fetch('/api/auth-status', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            const authData = await authResponse.json();
            
            if (authData.authenticated) {
                this.log('✅ 靜默檢查 - Session 有效');
                // 更新 sessionId（如果有變化）
                if (authData.sessionId && authData.sessionId !== this.sessionId) {
                    this.sessionId = authData.sessionId;
                    localStorage.setItem('spotify_session_id', this.sessionId);
                    this.log(`🔄 Session ID 已靜默更新: ${this.sessionId.substring(0, 8)}...`);
                    if (this.authChannel) {
                        this.authChannel.postMessage({ type: 'session-update', sessionId: this.sessionId });
                    }
                }
            } else {
                this.log('❌ 靜默檢查 - Session 已失效');
                // 只記錄，不強制重新登入
            }
        } catch (error) {
            this.log(`❌ 靜默檢查失敗: ${error.message}`);
        }
    }

    displayPlaylist(tracks) {
    if (!tracks || tracks.length === 0) {
        this.playlistContent.innerHTML = '<div class="loading">播放清單為空</div>';
        return;
    }

    const playlistHTML = tracks.map((track, index) => {
        // ✅ 正確解析 artists 與 album images
        const artistNames = track.artists?.map(a => a.name).join(', ') || '';
        const imageUrl = track.image || track.album?.images?.[0]?.url || null;
        

        return `
        <div class="playlist-item ${track.id === this.currentTrack?.id ? 'current' : ''}" data-track-id="${track.id}">
            ${imageUrl ? 
                `<img src="${imageUrl}" alt="${track.name}" 
                      style="width: 48px; height: 48px; object-fit: cover; border-radius: 4px; margin-right: 12px;"
                      onerror="this.style.display='none'; this.nextElementSibling.style.marginLeft='0';">` 
                : 
                `<div style="width: 48px; height: 48px; background: linear-gradient(135deg, #333, #555); 
                           border-radius: 4px; margin-right: 12px; display: flex; align-items: center; 
                           justify-content: center; color: #999; font-size: 20px;">🎵</div>`
            }
            <div class="playlist-item-info">
                <div class="playlist-item-title">${this.escapeHtml(track.name || '')}</div>
                <div class="playlist-item-artist">${this.escapeHtml(artistNames)}</div>
            </div>
        </div>`;
    }).join('');

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
                this.log('🔑 Devices API遇到401，直接觸發自動登入');
                await this.handle401Error();
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
                this.log('🔑 Transfer API遇到401，直接觸發自動登入');
                await this.handle401Error();
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

            const playUrl = '/api/player/play';
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
                this.log('🔑 播放API遇到401，直接觸發自動登入');
                await this.handle401Error();
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
        await new Promise(resolve => setTimeout(resolve, 200)); // 减少延迟
        
        try {
            const response = await fetch(`/api/library/check/${this.currentTrack.id}`, {
                headers: {
                    'X-Session-Id': this.sessionId
                }
            });
            
            if (response.status === 401) {
                this.log('🔑 喜欢状态检查遇到401，直接觸發自動登入');
                await this.handle401Error();
                return;
            }
            
            if (response.ok) {
                const data = await response.json();
                this.updateLikeButtonState(data.isLiked);
                this.log(`🎵 歌曲喜欢状态: ${data.isLiked ? '已喜欢' : '未喜欢'}`);
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

    // 保存當前歌詞為自定義
    async saveCurrentLyricsAsCustom() {
        if (!this.currentTrack) {
            this.showErrorMessage('沒有當前播放的歌曲');
            return;
        }

        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('沒有可保存的歌詞');
            return;
        }

        try {
            const source = {
                source: 'manual_save',
                title: `${this.currentTrack.artist} - ${this.currentTrack.name}`,
                artist: this.currentTrack.artist,
                savedAt: Date.now()
            };
            const saved = typeof this.saveUserCustomLyrics === 'function'
                ? await this.saveUserCustomLyrics(this.currentTrack, this.lyrics, this.lyricsType, source)
                : await window.kvStorageManager?.saveUserCustomLyrics(this.currentTrack, this.lyrics, this.lyricsType, source);

            if (saved) {
                // 同時保存到本地 localStorage
                const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
                const trackKey = this.generateTrackCacheKey(this.currentTrack);

                customLyrics[trackKey] = {
                    trackInfo: {
                        id: this.currentTrack.id,
                        name: this.currentTrack.name,
                        artist: this.currentTrack.artist,
                        album: this.currentTrack.album,
                        image: this.currentTrack.image
                    },
                    lyrics: this.lyrics,
                    lyricsType: this.lyricsType,
                    source,
                    lastUsed: Date.now()
                };

                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));

                this.showSuccessMessage('✅ 當前歌詞已保存為自定義歌詞');
            } else {
                throw new Error('保存失敗');
            }
        } catch (error) {
            console.error('保存當前歌詞失敗:', error);
            this.showErrorMessage('保存失敗，請稍後重試');
        }
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

    // 同步進度顯示
    showSyncProgress(current, total, taskName = '正在同步...') {
        // 創建或更新同步進度顯示
        let progressContainer = document.getElementById('sync-progress-display');
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.id = 'sync-progress-display';
            progressContainer.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(10px);
                color: white;
                padding: 16px;
                border-radius: 12px;
                z-index: 9999;
                min-width: 240px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.1);
                transition: all 0.3s ease;
            `;
            document.body.appendChild(progressContainer);
        }

        progressContainer.style.display = 'block';
        const percentage = total > 0 ? (current / total) * 100 : 0;

        progressContainer.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                <div class="sync-spinner" style="
                    width: 18px;
                    height: 18px;
                    border: 2px solid rgba(255,255,255,0.2);
                    border-top: 2px solid #1db954;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <div style="font-weight: 600; font-size: 14px;">${taskName}</div>
            </div>
            <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-bottom: 6px;">
                <div style="width: ${percentage}%; height: 100%; background: #1db954; transition: width 0.3s ease;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: rgba(255,255,255,0.6);">
                <span>${current} / ${total}</span>
                <span>${Math.round(percentage)}%</span>
            </div>
        `;

        // 添加旋轉動畫樣式
        if (!document.getElementById('sync-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'sync-spinner-style';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // 隱藏同步進度顯示
    hideSyncProgress() {
        const progressContainer = document.getElementById('sync-progress-display');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
    }

    // 同步所有已保存的歌詞到雲端
    async syncAllLyrics() {
        try {
            // 獲取所有已保存的歌詞
            const allLyrics = Array.from(this.savedLyrics.entries()).map(([key, value]) => ({
                key,
                ...value
            }));

            if (allLyrics.length === 0) {
                this.showSuccessMessage('✅ 沒有需要同步的歌詞');
                return;
            }

            this.log(`🔄 開始同步 ${allLyrics.length} 首歌詞到雲端`);

            // 顯示同步進度
            this.showSyncProgress(0, allLyrics.length);

            let syncedCount = 0;
            let failedCount = 0;

            // 分批同步，避免一次性請求太多
            const batchSize = 10;
            for (let i = 0; i < allLyrics.length; i += batchSize) {
                const batch = allLyrics.slice(i, i + batchSize);

                try {
                    const response = await fetch('/api/kv/batch-save-lyrics', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Session-Id': this.sessionId
                        },
                        body: JSON.stringify({ lyrics: batch })
                    });

                    if (response.ok) {
                        syncedCount += batch.length;
                    } else {
                        failedCount += batch.length;
                    }

                    // 更新進度顯示
                    this.showSyncProgress(syncedCount + failedCount, allLyrics.length);

                } catch (error) {
                    this.log(`❌ 批次同步失敗: ${error.message}`);
                    failedCount += batch.length;
                }
            }

            // 隱藏進度顯示
            this.hideSyncProgress();

            const successMessage = `✅ 同步完成！成功: ${syncedCount}, 失敗: ${failedCount}`;
            this.showSuccessMessage(successMessage);

            this.log(`✅ 歌詞同步完成: 成功 ${syncedCount}, 失敗 ${failedCount}`);
        } catch (error) {
            this.hideSyncProgress();
            this.showErrorMessage(`❌ 同步失敗: ${error.message}`);
            this.log(`❌ 同步過程中發生錯誤: ${error.message}`);
        }
    }

    // 匯出所有已保存的歌詞
    async exportAllLyrics() {
        try {
            // 獲取所有已保存的歌詞
            const allLyrics = Array.from(this.savedLyrics.entries()).map(([key, value]) => ({
                key,
                ...value
            }));

            if (allLyrics.length === 0) {
                this.showSuccessMessage('✅ 沒有保存的歌詞可供匯出');
                return;
            }

            // 創建匯出數據
            const exportData = {
                exportedAt: new Date().toISOString(),
                totalLyrics: allLyrics.length,
                lyrics: allLyrics
            };

            // 創建並下載文件
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `spotify-lyrics-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();

            // 清理
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            this.showSuccessMessage(`✅ 已匯出 ${allLyrics.length} 首歌詞`);
            this.log(`✅ 匯出 ${allLyrics.length} 首歌詞到文件`);
        } catch (error) {
            this.showErrorMessage(`❌ 匯出失敗: ${error.message}`);
            this.log(`❌ 匯出過程中發生錯誤: ${error.message}`);
        }
    }

    // 匯入歌詞
    async importLyrics(file) {
        try {
            const text = await file.text();
            const importData = JSON.parse(text);

            if (!importData.lyrics || !Array.isArray(importData.lyrics)) {
                throw new Error('無效的匯入檔案格式');
            }

            // 顯示匯入進度
            this.showSyncProgress(0, importData.lyrics.length);

            let importedCount = 0;
            let failedCount = 0;

            // 匯入歌詞到本地存儲
            for (const lyricData of importData.lyrics) {
                try {
                    const cacheKey = lyricData.key || this.generateTrackCacheKey(lyricData.trackInfo);
                    this.savedLyrics.set(cacheKey, lyricData);
                    importedCount++;
                } catch (error) {
                    failedCount++;
                    this.log(`❌ 匯入單首歌詞失敗: ${error.message}`);
                }

                // 更新進度
                this.showSyncProgress(importedCount + failedCount, importData.lyrics.length);
            }

            // 保存到本地存儲
            this.saveSavedLyricsToStorage();

            // 隱藏進度顯示
            this.hideSyncProgress();

            const successMessage = `✅ 匯入完成！成功: ${importedCount}, 失敗: ${failedCount}`;
            this.showSuccessMessage(successMessage);

            this.log(`✅ 匯入完成: 成功 ${importedCount}, 失敗 ${failedCount}`);
        } catch (error) {
            this.hideSyncProgress();
            this.showErrorMessage(`❌ 匯入失敗: ${error.message}`);
            this.log(`❌ 匯入過程中發生錯誤: ${error.message}`);
        }
    }

    // 初始化同步控制按鈕
    initSyncControls() {
        // 添加同步控制按鈕到歌詞控制區域
        const lyricsControls = document.querySelector('.lyrics-controls');
        if (lyricsControls) {
            // 檢查是否已經添加過按鈕
            if (!document.getElementById('sync-all-btn')) {
                const syncControlsHTML = '';

                // 添加到歌詞控制區域的開頭
                lyricsControls.insertAdjacentHTML('afterbegin', syncControlsHTML);

                // 綁定事件
                document.getElementById('save-current-lyrics-btn')?.addEventListener('click', () => {
                    if (typeof this.saveCurrentLyricsAsCustom === 'function') {
                        this.saveCurrentLyricsAsCustom();
                    } else {
                        // 如果方法不在當前對象中，嘗試從全局獲取
                        if (window.player && typeof window.player.saveCurrentLyricsAsCustom === 'function') {
                            window.player.saveCurrentLyricsAsCustom();
                        } else {
                            this.showErrorMessage('保存功能尚未加載');
                        }
                    }
                });

                document.getElementById('sync-all-btn')?.addEventListener('click', () => {
                    if (typeof this.syncAndMergeAllData === 'function') {
                        this.syncAndMergeAllData();
                    } else if (window.player && typeof window.player.syncAndMergeAllData === 'function') {
                        window.player.syncAndMergeAllData();
                    } else {
                        // 回退到舊方法
                        this.syncAllLyrics();
                    }
                });

                document.getElementById('export-all-btn')?.addEventListener('click', () => {
                    this.exportAllLyrics();
                });

                document.getElementById('import-lyrics-btn')?.addEventListener('click', () => {
                    // 創建文件選擇對話框
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = '.json';
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            this.importLyrics(file);
                        }
                    };
                    fileInput.click();
                });
            }
        }
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
        window.forceUpdateUI = () => playerInstance.forceUpdateUI();
        
        console.log('✅ Spotify 播放器已初始化');
        console.log('🛠️ 調試方法已暴露: debugCurrentTrack(), checkPollingStatus(), forceUpdateUI()');
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

class KVSyncManager {
    constructor() {
        this.syncButton = null;
        this.statusPanel = null;
        this.batchSize = 5; // 每批同步的項目數
        this.init();
    }

    init() {
        // Comment out createSyncUI to prevent errors
        // this.createSyncUI();
        this.bindEvents();
        setTimeout(() => this.checkSyncStatus(), 2000);
    }

    /*createSyncUI() {
        const panel = document.createElement('div');
        panel.id = 'kv-sync-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
            z-index: 999;
            font-size: 13px;
            min-width: 220px;
            display: none;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;

        panel.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: 600;">📤 KV 同步管理</div>
            <div id="kv-status" style="margin-bottom: 12px; font-size: 12px; opacity: 0.9;">
                檢查中...
            </div>
            <div style="display: flex; gap: 8px;">
                <button id="kv-sync-btn" style="
                    flex: 1;
                    padding: 8px 12px;
                    background: rgba(255,255,255,0.2);
                    border: 1px solid rgba(255,255,255,0.3);
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: all 0.2s;
                    font-family: inherit;
                ">
                    一鍵同步
                </button>
                <button id="kv-close-btn" style="
                    padding: 8px 12px;
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-family: inherit;
                ">
                    ✕
                </button>
            </div>
        `;

        document.body.appendChild(panel);
        this.statusPanel = panel;
        this.syncButton = document.getElementById('kv-sync-btn');
        // Create missing elements if they don't exist
        if (!this.syncButton) {
            console.log('⚠️ KV sync button not found in DOM, creating placeholder');
            this.syncButton = null; // Set to null to avoid errors
        }
    }*/

    bindEvents() {
        // Add null checks to prevent errors
        if (this.syncButton) {
            this.syncButton.addEventListener('click', () => this.performSync());
        }
        
        const kvCloseBtn = document.getElementById('kv-close-btn');
        if (kvCloseBtn) {
            kvCloseBtn.addEventListener('click', () => {
                if (this.statusPanel) {
                    this.statusPanel.style.display = 'none';
                }
            });
        }

        if (this.statusPanel) {
            this.statusPanel.addEventListener('mouseenter', () => {
                this.checkSyncStatus();
            });
        }
    }

    async checkSyncStatus() {
        try {
            if (!window.player || !window.player.sessionId) {
                console.log('⏳ 等待 Player 初始化...');
                return;
            }

            const response = await fetch('/api/kv/status', {
                headers: {
                    'X-Session-Id': window.player.sessionId
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const statusEl = document.getElementById('kv-status');

            if (data.kvAvailable) {
                statusEl.innerHTML = `
                    <span style="color: #4ade80;">✓ KV 已連接</span><br>
                    <span style="font-size: 11px; opacity: 0.8;">點擊下方按鈕同步本地數據</span>
                `;
                this.statusPanel.style.display = 'block';
                this.syncButton.disabled = false;
                this.syncButton.style.opacity = '1';
            } else {
                statusEl.innerHTML = `
                    <span style="color: #fbbf24;">⚠ KV 未配置</span><br>
                    <span style="font-size: 11px;">環境變數未設置</span>
                `;
                this.statusPanel.style.display = 'none';
            }
        } catch (error) {
            console.error('檢查 KV 狀態失敗:', error);
        }
    }

    // ✨ 改進：分批同步，避免 413 錯誤
    async performSync() {
        if (!window.player) {
            alert('播放器未初始化');
            return;
        }

        if (!window.player.sessionId) {
            alert('Session 未就緒，請稍候');
            return;
        }

        this.syncButton.disabled = true;
        const originalText = this.syncButton.textContent;
        this.syncButton.textContent = '同步中...';

        try {
            // 收集本地數據
            const savedLyrics = this.getSavedLyricsData();
            const timeAdjustments = this.getTimeAdjustmentsData();
            
            console.log(`📊 需要同步的數據:`);
            console.log(`  - 保存的歌詞: ${Object.keys(savedLyrics).length} 項`);
            console.log(`  - 時間調整: ${Object.keys(timeAdjustments).length} 項`);

            const results = {
                synced: 0,
                failed: 0,
                items: [],
                errors: []
            };

            // ✨ 分批同步歌詞
            const lyricsEntries = Object.entries(savedLyrics);
            if (lyricsEntries.length > 0) {
                this.showStatus('📝 同步歌詞...');
                const lyricsResults = await this.syncDataInBatches(
                    'lyrics',
                    lyricsEntries,
                    this.batchSize,
                    window.player.sessionId
                );
                results.synced += lyricsResults.synced;
                results.failed += lyricsResults.failed;
                results.items.push(...lyricsResults.items);
                results.errors.push(...lyricsResults.errors);
            }

            // ✨ 分批同步時間調整
            const offsetEntries = Object.entries(timeAdjustments);
            if (offsetEntries.length > 0) {
                this.showStatus('⏰ 同步時間調整...');
                const offsetResults = await this.syncDataInBatches(
                    'offset',
                    offsetEntries,
                    this.batchSize,
                    window.player.sessionId
                );
                results.synced += offsetResults.synced;
                results.failed += offsetResults.failed;
                results.items.push(...offsetResults.items);
                results.errors.push(...offsetResults.errors);
            }

            // 顯示最終結果
            const message = `✅ 同步完成！\n${results.synced} 項成功\n${results.failed} 項失敗`;
            this.showSuccessMessage(message);
            
            this.syncButton.textContent = '✓ 已同步';
            setTimeout(() => {
                this.syncButton.textContent = originalText;
                this.syncButton.disabled = false;
            }, 2000);

        } catch (error) {
            console.error('同步失敗:', error);
            this.showErrorMessage(`❌ 同步失敗\n${error.message}`);
            this.syncButton.disabled = false;
            this.syncButton.textContent = originalText;
        }
    }

    // ✨ 新增：分批同步方法
    async syncDataInBatches(type, entries, batchSize, sessionId) {
        const results = {
            synced: 0,
            failed: 0,
            items: [],
            errors: []
        };

        // 將數據分成多個批次
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            console.log(`📦 同步 ${type} 批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(entries.length / batchSize)}`);

            try {
                const batchData = {};
                batch.forEach(([key, value]) => {
                    batchData[key] = value;
                });

                // 建構請求体
                let requestBody = {};
                if (type === 'lyrics') {
                    requestBody = { savedLyrics: batchData };
                } else if (type === 'offset') {
                    requestBody = { timeAdjustments: batchData };
                }

                const response = await fetch('/api/kv/sync-all', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'X-Session-Id': sessionId
                    },
                    body: JSON.stringify(requestBody)
                });

                if (response.ok) {
                    const batchResult = await response.json();
                    results.synced += batchResult.summary?.synced || 0;
                    results.failed += batchResult.summary?.failed || 0;
                    results.items.push(...(batchResult.items || []));
                    if (batchResult.errors) {
                        results.errors.push(...batchResult.errors);
                    }
                    console.log(`✅ ${type} 批次 ${Math.floor(i / batchSize) + 1} 完成`);
                } else if (response.status === 413) {
                    console.warn(`⚠️ ${type} 批次太大，嘗試更小的批次`);
                    // 遞歸調用，使用更小的批次
                    const smallerBatch = await this.syncDataInBatches(
                        type,
                        batch,
                        Math.max(1, Math.floor(batchSize / 2)),
                        sessionId
                    );
                    results.synced += smallerBatch.synced;
                    results.failed += smallerBatch.failed;
                    results.items.push(...smallerBatch.items);
                    results.errors.push(...smallerBatch.errors);
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }

                // 批次之間稍作延遲，避免頻繁請求
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                console.error(`❌ ${type} 批次同步失敗:`, error);
                results.failed += batch.length;
                batch.forEach(([key]) => {
                    results.errors.push({
                        type: type,
                        key: key,
                        error: error.message
                    });
                });
            }
        }

        return results;
    }

    showStatus(message) {
        const statusEl = document.getElementById('kv-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    getSavedLyricsData() {
        try {
            const saved = localStorage.getItem('saved_lyrics');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error('讀取保存的歌詞失敗:', e);
            return {};
        }
    }

    getTimeAdjustmentsData() {
        try {
            const adjustments = localStorage.getItem('lyrics_time_adjustments');
            return adjustments ? JSON.parse(adjustments) : {};
        } catch (e) {
            console.error('讀取時間調整失敗:', e);
            return {};
        }
    }

    showSuccessMessage(message) {
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = `
            position: fixed;
            bottom: 110px;
            left: 20px;
            background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(74, 222, 128, 0.3);
            z-index: 1000;
            white-space: pre-line;
            font-weight: 500;
            animation: slideIn 0.3s ease;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        msgDiv.textContent = message;
        document.body.appendChild(msgDiv);

        setTimeout(() => {
            msgDiv.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => msgDiv.remove(), 300);
        }, 3000);
    }

    showErrorMessage(message) {
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = `
            position: fixed;
            bottom: 110px;
            left: 20px;
            background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(248, 113, 113, 0.3);
            z-index: 1000;
            white-space: pre-line;
            font-weight: 500;
            animation: slideIn 0.3s ease;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        msgDiv.textContent = message;
        document.body.appendChild(msgDiv);

        setTimeout(() => {
            msgDiv.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => msgDiv.remove(), 300);
        }, 4000);
    }
}

// 初始化 KV 同步管理器 (延遲初始化，確保 Player 準備好)
// ⚠️ 暂时禁用 KVSyncManager 以防止 DOM 错误
/*
setTimeout(() => {
    try {
        if (typeof KVSyncManager !== 'undefined' && !window.kvSyncManager) {
            window.kvSyncManager = new KVSyncManager();
            console.log('✅ KV 同步管理器已初始化');
        }
    } catch (error) {
        console.log('⚠️ KV 同步管理器初始化失敗:', error.message);
        // KVSyncManager 可能因为缺少 DOM 元素而失败，这是正常的
    }
}, 3000);
*/

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

// ============================================
// 優化版自動同步 + 設定合併系統
// ============================================

class OptimizedAutoSyncManager {
    constructor(options = {}) {
        this.autoSyncInterval = options.autoSyncInterval || 5 * 60 * 1000; // 5分鐘
        this.batchSize = options.batchSize || 3;
        this.maxRetries = options.maxRetries || 3;
        
        // 同步狀態
        this.isSyncing = false;
        this.pendingChanges = {
            lyrics: new Map(),
            offsets: new Map()
        };
        this.syncQueue = [];
        this.lastSyncTime = 0;
        this.syncStats = {
            totalSynced: 0,
            totalFailed: 0,
            lastSyncAt: null
        };
        
        // ✨ 改進：使用 Toast 通知代替 Alert
        this.toastContainer = null;
        this.notificationQueue = [];
        
        // UI 元素
        this.statusPanel = null;
        this.syncButton = null;
        this.settingsDropdown = null;
        
        this.init();
    }

    init() {
        // this.createSyncUI();
        this.bindEvents();
        // setTimeout(() => this.checkSyncStatus(), 2000);
    }

    /* createSyncUI() {
        const panel = document.createElement('div');
        panel.id = 'kv-sync-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
            z-index: 999;
            font-size: 13px;
            min-width: 220px;
            display: none;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;

        panel.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: 600;">📤 KV 同步管理</div>
            <div id="kv-status" style="margin-bottom: 12px; font-size: 12px; opacity: 0.9;">
                檢查中...
            </div>
            <button id="force-sync-btn" style="
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s ease;
            ">立即同步</button>
        `;
        
        document.body.appendChild(panel);
        
        document.getElementById('force-sync-btn')?.addEventListener('click', () => {
            this.forceSync();
        });
    } */

    bindEvents() {
        const syncCloseBtn = document.getElementById('sync-close-btn');
        if (syncCloseBtn) {
            syncCloseBtn.addEventListener('click', () => {
                if (this.statusPanel) {
                    this.statusPanel.style.display = 'none';
                }
            });
        }

        const manualSyncBtn = document.getElementById('manual-sync-btn');
        if (manualSyncBtn) {
            manualSyncBtn.addEventListener('click', () => {
                this.triggerSync('manual');
            });
        }

        const syncSettingsBtn = document.getElementById('sync-settings-btn');
        if (syncSettingsBtn) {
            syncSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSettingsDropdown();
            });
        }
        
        // Initialize settings dropdown reference
        this.settingsDropdown = document.getElementById('sync-settings-dropdown');

        // ✨ 改進：關閉設定時隱藏下拉菜單
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#sync-settings-btn') && 
                !e.target.closest('#sync-settings-dropdown')) {
                if (this.settingsDropdown) {
                    this.settingsDropdown.style.display = 'none';
                }
            }
        });

        // 設定事件監聽
        document.getElementById('auto-sync-enable')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startAutoSync();
                this.showToast('✅ 自動同步已啟用', 'success');
            } else {
                this.stopAutoSync();
                this.showToast('⏸️ 自動同步已停用', 'info');
            }
        });

        document.getElementById('sync-notifications')?.addEventListener('change', (e) => {
            localStorage.setItem('sync_show_notifications', e.target.checked);
            this.showToast(
                e.target.checked ? '✅ 同步通知已啟用' : '⏸️ 同步通知已禁用',
                e.target.checked ? 'success' : 'info'
            );
        });

        document.getElementById('sync-interval-input')?.addEventListener('change', (e) => {
            const interval = parseInt(e.target.value);
            if (interval > 0 && interval <= 60) {
                this.autoSyncInterval = interval * 60 * 1000;
                localStorage.setItem('auto_sync_interval', interval);
                this.showToast(`✅ 同步間隔已設置為 ${interval} 分鐘`, 'success');
                this.restartAutoSync();
            }
        });
    }

    toggleSettingsDropdown() {
        if (this.settingsDropdown.style.display === 'block') {
            this.settingsDropdown.style.display = 'none';
        } else {
            this.settingsDropdown.style.display = 'block';
        }
    }

    // ✨ 改進：使用 Toast 通知代替 Alert
    showToast(message, type = 'info', duration = 3000) {
        // 檢查是否應該顯示通知
        const showNotifications = localStorage.getItem('sync_show_notifications') !== 'false';
        if (!showNotifications && type !== 'error') {
            return;
        }

        // 創建或獲取 toast 容器
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'optimized-sync-toast-container';
            this.toastContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                align-items: flex-end;
            `;
            document.body.appendChild(this.toastContainer);
        }

        const toast = document.createElement('div');
        const colors = {
            success: 'rgba(74, 222, 128, 0.9)',
            error: 'rgba(248, 113, 113, 0.9)',
            info: 'rgba(96, 165, 250, 0.9)',
            warning: 'rgba(251, 191, 36, 0.9)'
        };

        toast.style.cssText = `
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            animation: slideInRight 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 200px;
            max-width: 300px;
            word-break: break-word;
            margin-bottom: 8px;
        `;

        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        // 添加動畫樣式
        if (!document.querySelector('style[data-toast-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-toast-animation', 'true');
            style.textContent = `
                @keyframes slideInRight {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes slideOutRight {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // 自動移除
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);

                    // 如果容器中沒有更多 toast，可以移除容器
                    if (this.toastContainer && this.toastContainer.children.length === 0) {
                        if (this.toastContainer.parentNode) {
                            this.toastContainer.parentNode.removeChild(this.toastContainer);
                            this.toastContainer = null;
                        }
                    }
                }
            }, 300);
        }, duration);
    }

    monitorLocalChanges() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'saved_lyrics' || e.key === 'lyrics_time_adjustments') {
                console.log(`📝 檢測到本地改變: ${e.key}`);
                this.detectChanges();
            }
        });

        setInterval(() => {
            this.detectChanges();
        }, 10000);
    }

    detectChanges() {
        try {
            const savedLyrics = JSON.parse(localStorage.getItem('saved_lyrics') || '{}');
            const prevLyricsHash = sessionStorage.getItem('lyrics_hash') || '';
            const currentLyricsHash = JSON.stringify(savedLyrics);

            if (prevLyricsHash !== currentLyricsHash) {
                console.log(`📝 偵測到歌詞改變 (${Object.keys(savedLyrics).length} 項)`);
                this.updatePendingChanges('lyrics', savedLyrics);
                sessionStorage.setItem('lyrics_hash', currentLyricsHash);
            }

            const timeAdjustments = JSON.parse(localStorage.getItem('lyrics_time_adjustments') || '{}');
            const prevOffsetsHash = sessionStorage.getItem('offsets_hash') || '';
            const currentOffsetsHash = JSON.stringify(timeAdjustments);

            if (prevOffsetsHash !== currentOffsetsHash) {
                console.log(`⏰ 偵測到時間調整改變 (${Object.keys(timeAdjustments).length} 項)`);
                this.updatePendingChanges('offsets', timeAdjustments);
                sessionStorage.setItem('offsets_hash', currentOffsetsHash);
            }

            this.updateUI();
        } catch (error) {
            console.error('❌ 偵測改變失敗:', error);
        }
    }

    updatePendingChanges(type, data) {
        const map = this.pendingChanges[type];
        Object.entries(data).forEach(([key, value]) => {
            const existing = map.get(key);
            if (!existing || JSON.stringify(existing) !== JSON.stringify(value)) {
                map.set(key, {
                    data: value,
                    addedAt: Date.now(),
                    retries: 0
                });
            }
        });

        console.log(`📦 ${type} 待同步: ${map.size} 項`);
    }

    startAutoSync() {
        this.autoSyncInterval = 
            (parseInt(localStorage.getItem('auto_sync_interval')) || 5) * 60 * 1000;
        
        setInterval(() => {
            const pendingLyrics = this.pendingChanges.lyrics.size;
            const pendingOffsets = this.pendingChanges.offsets.size;
            const totalPending = pendingLyrics + pendingOffsets;

            if (totalPending > 0 && !this.isSyncing) {
                console.log(`⏰ 自動同步觸發 (待同步: ${totalPending} 項)`);
                this.triggerSync('auto');
            }
        }, this.autoSyncInterval);

        console.log(`⏰ 自動同步定時器已啟動 (${this.autoSyncInterval / 1000 / 60} 分鐘)`);
    }

    stopAutoSync() {
        console.log('⏸️ 自動同步已停止');
    }

    restartAutoSync() {
        console.log('🔄 重新啟動自動同步...');
        // 實現重新啟動邏輯
    }

    async triggerSync(source = 'manual') {
        if (this.isSyncing) {
            console.log('⏳ 已有同步在進行中');
            return;
        }

        if (!window.player || !window.player.sessionId) {
            console.log('⚠️ 播放器未初始化');
            return;
        }

        this.isSyncing = true;
        console.log(`🔄 開始同步 (來源: ${source})`);

        try {
            this.buildSyncQueue();

            while (this.syncQueue.length > 0 && navigator.onLine) {
                const batch = this.syncQueue.splice(0, this.batchSize);
                await this.syncBatch(batch);
                this.updateProgressBar();
                await this.delay(500);
            }

            // ✨ 改進：使用 Toast 通知
            const message = `✅ 同步完成 (${this.syncStats.totalSynced} 項)`;
            this.showToast(message, 'success', 4000);
            
            console.log(`✅ 同步完成! 已同步: ${this.syncStats.totalSynced}, 失敗: ${this.syncStats.totalFailed}`);
            
        } catch (error) {
            console.error('❌ 同步過程中出錯:', error);
            this.showToast(`❌ 同步失敗: ${error.message}`, 'error', 5000);
        } finally {
            this.isSyncing = false;
            this.lastSyncTime = Date.now();
            this.syncStats.lastSyncAt = new Date().toLocaleTimeString();
            this.updateUI();
        }
    }

    buildSyncQueue() {
        this.syncQueue = [];
        
        this.pendingChanges.lyrics.forEach((item, key) => {
            this.syncQueue.push({
                type: 'lyrics',
                key: key,
                item: item
            });
        });

        this.pendingChanges.offsets.forEach((item, key) => {
            this.syncQueue.push({
                type: 'offsets',
                key: key,
                item: item
            });
        });

        console.log(`📋 同步隊列已構建: ${this.syncQueue.length} 項`);
    }

    async syncBatch(batch) {
        const batchData = {
            savedLyrics: {},
            timeAdjustments: {}
        };

        batch.forEach(task => {
            if (task.type === 'lyrics') {
                batchData.savedLyrics[task.key] = task.item.data;
            } else if (task.type === 'offsets') {
                batchData.timeAdjustments[task.key] = task.item.data;
            }
        });

        try {
            console.log(`📦 同步批次 (${batch.length} 項)`);

            let synced = 0;
            let failed = 0;

            for (const task of batch) {
                try {
                    if (task.type === 'lyrics') {
                        const lyricData = task.item.data;

                        // Validate data before sending
                        if (!lyricData || !lyricData.trackInfo || !lyricData.trackInfo.id) {
                            console.warn(`⚠️ 跳過無效歌詞數據: 缺少 trackInfo 或 ID - Key: ${task.key}`);
                            failed++;
                            continue;
                        }

                        const response = await fetch('/api/kv/user-lyrics', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json; charset=utf-8',
                                'X-Session-Id': window.player.sessionId
                            },
                            body: JSON.stringify({
                                trackInfo: lyricData.trackInfo,
                                lyrics: lyricData.lyrics,
                                lyricsType: lyricData.lyricsType || 'synced',
                                source: lyricData.source || 'custom'
                            })
                        });

                        if (response.ok) {
                            synced++;
                            this.pendingChanges.lyrics.delete(task.key);
                        } else {
                            const responseText = await response.text();
                            console.error(`❌ 歌詞同步失敗: ${response.status} - ${responseText} - Track: ${lyricData.trackInfo?.name}`);
                            failed++;
                        }
                    } else if (task.type === 'offsets') {
                        const offsetData = task.item.data;

                        // Validate data before sending
                        if (!offsetData || !offsetData.trackInfo || !offsetData.trackInfo.id) {
                            console.warn(`⚠️ 跳過無效時間調整數據: 缺少 trackInfo 或 ID - Key: ${task.key}`);
                            failed++;
                            continue;
                        }

                        const response = await fetch('/api/kv/save-time-offset', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json; charset=utf-8',
                                'X-Session-Id': window.player.sessionId
                            },
                            body: JSON.stringify({
                                trackInfo: offsetData.trackInfo,
                                timeOffset: offsetData.timeOffset
                            })
                        });

                        if (response.ok) {
                            synced++;
                            this.pendingChanges.offsets.delete(task.key);
                        } else {
                            const responseText = await response.text();
                            console.error(`❌ 時間調整同步失敗: ${response.status} - ${responseText} - Track: ${offsetData.trackInfo?.name}`);
                            failed++;
                        }
                    }
                } catch (taskError) {
                    console.error(`❌ 同步任務失敗:`, taskError);
                    failed++;
                }
            }

            this.syncStats.totalSynced += synced;
            this.syncStats.totalFailed += failed;

            console.log(`✅ 批次同步完成 (${synced} 成功, ${failed} 失敗)`);

        } catch (error) {
            console.error(`❌ 批次同步失敗:`, error);

            batch.forEach(task => {
                const pendingItem = task.type === 'lyrics' ?
                    this.pendingChanges.lyrics.get(task.key) :
                    this.pendingChanges.offsets.get(task.key);

                if (pendingItem && pendingItem.retries < this.maxRetries) {
                    pendingItem.retries++;
                    console.log(`🔄 ${task.key} 將在下次同步時重試 (${pendingItem.retries}/${this.maxRetries})`);
                }
            });
        }
    }

    updateUI() {
        const pendingLyrics = this.pendingChanges.lyrics.size;
        const pendingOffsets = this.pendingChanges.offsets.size;
        const totalPending = pendingLyrics + pendingOffsets;

        // 安全地更新元素，檢查元素是否存在
        const pendingCountEl = document.getElementById('pending-count');
        if (pendingCountEl) {
            pendingCountEl.textContent = totalPending;
        }

        const syncedCountEl = document.getElementById('synced-count');
        if (syncedCountEl) {
            syncedCountEl.textContent = this.syncStats.totalSynced;
        }

        const failedCountEl = document.getElementById('failed-count');
        if (failedCountEl) {
            failedCountEl.textContent = this.syncStats.totalFailed;
        }

        const statusIcon = document.getElementById('sync-status-icon');
        if (statusIcon) {
            if (this.isSyncing) {
                statusIcon.textContent = '⏳';
            } else if (totalPending > 0) {
                statusIcon.textContent = '🔔';
            } else {
                statusIcon.textContent = '✅';
            }
        }
    }

    updateProgressBar() {
        const totalItems = this.syncQueue.length + this.syncStats.totalSynced;
        const progress = totalItems > 0 ? (this.syncStats.totalSynced / totalItems * 100) : 0;

        const progressBar = document.getElementById('sync-progress-bar');
        if (progressBar) {
            progressBar.style.width = progress + '%';
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 初始化優化的自動同步管理器
document.addEventListener('DOMContentLoaded', () => {
    if (!window.optimizedAutoSyncManager && window.player) {
        window.optimizedAutoSyncManager = new OptimizedAutoSyncManager({
            autoSyncInterval: 5 * 60 * 1000,
            batchSize: 3
        });
        console.log('✨ 優化的自動同步系統已啟動');
    }
});

// 如果 player 還未初始化，等待後初始化
if (!window.player) {
    const checkInterval = setInterval(() => {
        if (window.player && !window.optimizedAutoSyncManager) {
            window.optimizedAutoSyncManager = new OptimizedAutoSyncManager({
                autoSyncInterval: 5 * 60 * 1000,
                batchSize: 3
            });
            clearInterval(checkInterval);
            console.log('✨ 優化的自動同步系統已啟動');
        }
    }, 1000);
}

// 🎵 动画系统扩展
SpotifyLyricsPlayer.prototype.triggerSongChangeAnimation = function() {
    // 通知动态背景系统歌曲变化
    // 动态背景系统已移除
    
    this.log('🎭 触发歌曲切换动画');
    
    // 播放器容器动画
    if (this.playerSection) {
        this.playerSection.classList.remove('song-changing');
        this.playerSection.offsetHeight;
        this.playerSection.classList.add('song-changing');
        
        setTimeout(() => {
            if (this.playerSection) {
                this.playerSection.classList.remove('song-changing');
            }
        }, 800);
    }

    // 专辑封面切换动画
    this.animateAlbumArtChange();
    this.animateTextChange();
    this.animateLyricsChange();
};

SpotifyLyricsPlayer.prototype.animateAlbumArtChange = function() {
    const albumArt = document.querySelector('.album-art img, .album-art');
    if (albumArt) {
        albumArt.classList.add('transition-out');
        setTimeout(() => {
            albumArt.classList.remove('transition-out');
            albumArt.classList.add('transition-in');
            setTimeout(() => albumArt.classList.remove('transition-in'), 600);
        }, 400);
    }
};

SpotifyLyricsPlayer.prototype.animateTextChange = function() {
    const trackTitle = document.querySelector('.track-title');
    const trackArtist = document.querySelector('.track-artist');
    
    [trackTitle, trackArtist].forEach((element, index) => {
        if (element) {
            element.classList.remove('text-transition');
            element.offsetHeight;
            element.classList.add('text-transition');
            setTimeout(() => element.classList.remove('text-transition'), 800 + index * 100);
        }
    });
};

SpotifyLyricsPlayer.prototype.animateLyricsChange = function() {
    const lyricsContent = document.querySelector('.lyrics-content');
    if (lyricsContent) {
        lyricsContent.classList.remove('lyrics-changing');
        lyricsContent.offsetHeight;
        lyricsContent.classList.add('lyrics-changing');
        setTimeout(() => lyricsContent.classList.remove('lyrics-changing'), 800);
    }
};

SpotifyLyricsPlayer.prototype.updatePlayButtonAnimation = function(isPlaying) {
    const playBtn = document.querySelector('.play-btn');
    if (playBtn) playBtn.classList.toggle('playing', isPlaying);
};

SpotifyLyricsPlayer.prototype.updateProgressPulse = function(isPlaying) {
    const progressFill = document.querySelector('.progress-fill');
    if (progressFill) progressFill.classList.toggle('progress-pulse', isPlaying);
    
    // 通知动态背景系统播放状态变化
    if (window.dynamicBG) {
        window.dynamicBG.onPlayStateChange(isPlaying);
    }
};

SpotifyLyricsPlayer.prototype.addAlbumBreathingEffect = function(enabled) {
    const albumArt = document.querySelector('.album-art img, .album-art');
    if (albumArt) albumArt.classList.toggle('breathing', enabled);
};

// 頁面卸載時清理
window.addEventListener('beforeunload', () => {
    if (player) {
        player.stopTracking();
        player.stopPeriodicSessionCheck();
        console.log('🧹 播放器已清理');
    }
});

// 页面完全加载后再次检查是否需要自动登录
window.addEventListener('load', () => {
    setTimeout(() => {
        if (window.player) {
            // 不仅检查sessionId，还要检查页面状态
            const needsLogin = !window.player.sessionId || 
                              document.querySelector('#login-btn, .login-btn, [href*="auth"]') ||
                              (window.player.authSection && getComputedStyle(window.player.authSection).display !== 'none');
                              
            if (needsLogin) {
                console.log('🔄 页面加载完成，检查是否需要自动登录...');
                window.player.scheduleAutoLogin();
            }
        }
    }, 2000);
});

// 页面变为可见时检查认证状态
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.player) {
        // 增强的可见性检查
        const needsLogin = !window.player.sessionId || 
                          document.querySelector('#login-btn, .login-btn, [href*="auth"]') ||
                          (window.player.authSection && getComputedStyle(window.player.authSection).display !== 'none');
                          
        if (needsLogin) {
            console.log('🔄 页面变为可见，检查认证状态...');
            setTimeout(() => {
                window.player.scheduleAutoLogin();
            }, 1000);
        }
    }
});

// 即時統計功能
SpotifyLyricsPlayer.prototype.initLiveStats = function() {
    this.log('📊 初始化即時統計功能');
    
    this.localTotalDurationMs = 0;
    this.lastTickTime = Date.now();
    
    // 立即更新一次
    if (this.sessionId) {
        this.updateLiveStats();
    }
    
    // 設定定時更新 (每 5 秒，從伺服器獲取權威數據)
    this.liveStatsInterval = setInterval(() => {
        if (this.sessionId) {
            this.updateLiveStats();
        }
    }, 5000);

    // 設定秒級跳動 (每 1 秒，本地樂觀更新)
    // 即使 Spotify 還沒回傳「已暫停」，我們也會繼續跳動，直到下次 API 同步時自動校正回來
    this.liveTickInterval = setInterval(() => {
        const now = Date.now();
        const delta = now - this.lastTickTime;
        this.lastTickTime = now;
        
        if (this.currentTrack?.isPlaying && this.localTotalDurationMs > 0) {
            this.localTotalDurationMs += delta;
            this.renderTotalTime(this.localTotalDurationMs);
            
            // 同時更新最近歷史中「正在播放」的那一項時長
            this.tickRecentHistoryCurrentItem(delta);
        }
    }, 1000);

    // 綁定面板事件
    document.getElementById('close-history-btn')?.addEventListener('click', () => {
        document.getElementById('recent-history-panel')?.classList.add('hidden');
    });

    document.getElementById('stats-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        const panel = document.getElementById('recent-history-panel');
        if (panel) {
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                this.updateLiveStats();
            }
        }
    });
};

SpotifyLyricsPlayer.prototype.renderTotalTime = function(ms) {
    const totalTimeEl = document.getElementById('live-total-time');
    if (totalTimeEl) {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);
        totalTimeEl.textContent = `${hours} 時 ${minutes} 分 ${seconds} 秒`;
    }
};

SpotifyLyricsPlayer.prototype.tickRecentHistoryCurrentItem = function(delta) {
    const firstItemDuration = document.querySelector('.history-item:first-child .history-duration');
    const firstItemName = document.querySelector('.history-item:first-child .history-track-name')?.textContent;
    
    // 如果最近歷史的第一項就是目前正在播放的歌，就讓它也一起跳動
    if (firstItemDuration && this.currentTrack && firstItemName === this.currentTrack.name) {
        // 解析目前顯示的時間 (M:SS)
        const parts = firstItemDuration.textContent.split(':');
        if (parts.length === 2) {
            let totalSeconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            // 這裡我們暫存一個毫秒值在元素上，避免解析誤差
            if (!firstItemDuration.dataset.ms) {
                firstItemDuration.dataset.ms = totalSeconds * 1000;
            }
            
            let currentMs = parseInt(firstItemDuration.dataset.ms) + delta;
            firstItemDuration.dataset.ms = currentMs;
            
            const m = Math.floor(currentMs / 60000);
            const s = Math.floor((currentMs % 60000) / 1000);
            firstItemDuration.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }
    }
};

SpotifyLyricsPlayer.prototype.updateLiveStats = async function() {
    if (!this.sessionId) return;
    
    try {
        const response = await fetch('/api/stats/listening?days=1', {
            headers: { 'X-Session-Id': this.sessionId }
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        if (data.success) {
            // 平滑校正：計算伺服器與本地的差值，避免突然跳動
            const serverDuration = data.totalDurationMs;
            
            // 如果是首次載入（本地為 0）或尚未開始計時，直接同步
            if (this.localTotalDurationMs === 0) {
                this.localTotalDurationMs = serverDuration;
            } else {
                // 播放中才進行平滑校正
                const diff = serverDuration - this.localTotalDurationMs;
                
                // 只有當差值在合理範圍內（±30秒）才進行平滑校正
                // 如果差異太大（可能是重新載入頁面或長時間後台），直接同步
                if (Math.abs(diff) <= 30000) {
                    // 小差異（≤2秒）直接同步，大差異逐步調整
                    if (Math.abs(diff) <= 2000) {
                        this.localTotalDurationMs = serverDuration;
                    } else {
                        // 每次最多調整 3 秒，避免突然跳動
                        const adjustment = Math.sign(diff) * Math.min(Math.abs(diff), 3000);
                        this.localTotalDurationMs += adjustment;
                    }
                } else {
                    // 差異過大，直接同步
                    this.localTotalDurationMs = serverDuration;
                }
            }
            
            this.renderTotalTime(this.localTotalDurationMs);
            this.lastTickTime = Date.now(); // 同步後重置計時點
            
            const songCountEl = document.getElementById('live-song-count');
            if (songCountEl) {
                songCountEl.textContent = `${data.songCount}首`;
            }
            
            // 更新最近歷史面板
            this.updateRecentHistoryUI(data.history);
        }
    } catch (error) {
        this.log(`❌ 更新即時統計失敗: ${error.message}`);
    }
};

SpotifyLyricsPlayer.prototype.updateRecentHistoryUI = function(history) {
    const listEl = document.getElementById('recent-history-list');
    if (!listEl) return;
    
    if (!history || history.length === 0) {
        listEl.innerHTML = '<li class="history-item"><div class="history-item-info">暫無歷史數據</div></li>';
        return;
    }
    
    listEl.innerHTML = history.slice(0, 15).map(item => {
        const date = new Date(item.playedAt);
        const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        
        const dMs = item.durationMs || 0;
        const dMin = Math.floor(dMs / 60000);
        const dSec = Math.floor((dMs % 60000) / 1000);
        const durationStr = `${dMin}:${dSec.toString().padStart(2, '0')}`;
        
        return `
            <li class="history-item">
                <div class="history-item-info">
                    <span class="history-track-name">${this.escapeHtml(item.trackName)}</span>
                    <span class="history-artist-name">${this.escapeHtml(item.artistName)} • ${timeStr}</span>
                </div>
                <span class="history-duration">${durationStr}</span>
            </li>
        `;
    }).join('');
};

// URL变化时检查是否需要登录（处理SPA路由）
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(() => {
            if (window.player && (!window.player.sessionId || document.querySelector('#login-btn, .login-btn, [href*="auth"]'))) {
                console.log('🔄 URL变化，检查是否需要自动登录...');
                window.player.scheduleAutoLogin();
            }
        }, 1000);
    }
}).observe(document, { subtree: true, childList: true });