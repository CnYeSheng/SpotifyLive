class SpotifyLyricsPlayer {
    constructor() {
        this.currentTrack = null;
        this.lyrics = [];
        this.lyricsType = 'plain'; // 'synced' 或 'plain'
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
        
        this.initializeElements();
        this.bindEvents();
        this.handleAuthCallback();
        this.checkAuthStatus();
    }

    handleAuthCallback() {
        // 檢查是否從認證回調返回
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'success') {
            this.sessionId = urlParams.get('session');
            if (this.sessionId) {
                localStorage.setItem('spotify_session_id', this.sessionId);
            }
            // 清除 URL 參數
            window.history.replaceState({}, document.title, window.location.pathname);
            // 顯示成功訊息
            this.showSuccessMessage('🎉 Spotify 連接成功！');
        } else {
            // 嘗試從 localStorage 恢復 session
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
        
        // 添加動畫樣式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(successDiv);
        
        // 3秒後自動移除
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
        this.volumeSlider = document.getElementById('volume-slider');
        this.volumeValue = document.getElementById('volume-value');
        this.deviceInfo = document.getElementById('device-info');
        this.deviceName = document.getElementById('device-name');
        this.nextTrackPreview = document.getElementById('next-track-preview');
        this.nextTrackName = document.getElementById('next-track-name');
        // this.playIndicator = document.getElementById('play-indicator'); // 已移除
        
        // 模態框元素
        this.fontSizeModal = document.getElementById('font-size-modal');
        this.closeModalBtn = document.getElementById('close-modal');
        this.fontOptions = document.querySelectorAll('.font-option');
    }

    bindEvents() {
        // 登入按鈕
        this.loginBtn?.addEventListener('click', () => {
            window.location.href = '/auth';
        });

        // 重新檢查按鈕
        this.refreshBtn?.addEventListener('click', () => {
            this.checkCurrentTrack();
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
                
                // 更新活躍狀態
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

        // 播放控制事件
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
        this.checkCurrentTrack();
        this.updateInterval = setInterval(() => {
            this.checkCurrentTrack();
        }, 3000); // 每3秒檢查一次 (官方限制)
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
    }

    async checkCurrentTrack() {
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }
            
            const response = await fetch('/api/current-track', { headers });
            
            if (response.status === 401) {
                this.showAuthSection();
                this.stopTracking();
                localStorage.removeItem('spotify_session_id');
                this.sessionId = null;
                return;
            }

            if (!response.ok) {
                console.error(`API 錯誤: ${response.status} ${response.statusText}`);
                if (response.status >= 500) {
                    console.log('服务器错误，稍后重试...');
                    setTimeout(() => this.checkCurrentTrack(), 5000);
                }
                this.updateStatus('spotify', false);
                return;
            }

            const data = await response.json();
            
            if (!data.name) {
                this.showNoMusicSection();
                return;
            }

            const isNewTrack = !this.currentTrack || 
                              this.currentTrack.id !== data.id ||
                              this.currentTrack.name !== data.name;

            this.currentTrack = data;
            this.currentTrack.lastUpdated = Date.now();
            this.updateTrackInfo();
            this.updatePlayerControls();

            if (isNewTrack) {
                this.loadLyrics();
                this.loadNextTrackPreview();
            } else {
                // 如果不是新歌，不要重複載入歌詞
                console.log('相同歌曲，跳過歌詞載入');
            }
            
            this.updateProgress();
            this.showPlayerSection();
            this.updateStatus('spotify', true);

        } catch (error) {
            console.error('獲取當前播放失敗:', error);
            this.updateStatus('spotify', false);
            setTimeout(() => this.checkCurrentTrack(), 5000);
        }
    }

    updateTrackInfo() {
        if (!this.currentTrack) return;

        this.albumImage.src = this.currentTrack.image || '';
        this.albumImage.alt = `${this.currentTrack.album} 專輯封面`;
        this.trackName.textContent = this.currentTrack.name;
        this.artistName.textContent = this.currentTrack.artist;
        this.albumName.textContent = this.currentTrack.album;
        this.totalTime.textContent = this.formatTime(this.currentTrack.duration);
        
        // 提取專輯封面顏色並更新背景（避免重複提取）
        if (this.currentTrack.image && this.currentTrack.image !== this.lastExtractedImageUrl) {
            this.lastExtractedImageUrl = this.currentTrack.image;
            this.extractColorsAndUpdateBackground(this.currentTrack.image);
        }
        
        // 更新設備信息
        if (this.currentTrack.device && this.deviceInfo) {
            this.deviceName.textContent = `${this.currentTrack.device.name} (${this.currentTrack.device.type})`;
            this.deviceInfo.style.display = 'block';
            
            // 更新音量滑塊
            if (this.currentTrack.device.volume !== null && this.volumeSlider) {
                this.volumeSlider.value = this.currentTrack.device.volume;
                this.volumeValue.textContent = `${this.currentTrack.device.volume}%`;
            }
        } else if (this.deviceInfo) {
            this.deviceInfo.style.display = 'none';
        }
    }

    updateProgress() {
        if (!this.currentTrack) return;

        // 停止之前的动画
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
                // 播放中：计算实时进度
                elapsedTime = (Date.now() - this.currentTrack.lastUpdated) + this.currentTrack.progress;
            } else {
                // 暫停中：使用固定进度
                elapsedTime = this.currentTrack.progress;
            }
            
            const progress = (elapsedTime / this.currentTrack.duration) * 100;
            this.progressFill.style.width = `${Math.min(100, progress)}%`;
            this.currentTime.textContent = this.formatTime(elapsedTime);

            // 更新歌词高亮（无论播放还是暂停）
            this.updateLyricsHighlight(elapsedTime);

            // 檢查是否接近歌曲結束（最後5秒）
            const remainingTime = this.currentTrack.duration - elapsedTime;
            if (remainingTime <= 5000 && remainingTime > 0 && this.currentTrack.isPlaying) {
                this.showNextTrackPreview();
            }

            // 只有在播放时才继续动画
            if (this.currentTrack.isPlaying && elapsedTime < this.currentTrack.duration) {
                this.animationFrameId = requestAnimationFrame(update);
            } else {
                this.animationFrameId = null;
            }
        };

        // 立即执行一次更新
        update();
    }

    async loadLyrics() {
        if (!this.currentTrack) return;

        // 檢查是否已經有相同歌曲的歌詞
        if (this.lyrics && this.lyrics.length > 0 && this.currentLyricsTrackId === this.currentTrack.id) {
            console.log('歌詞已存在，跳過載入');
            return;
        }

        // 防止重複請求
        if (this.isLoadingLyrics) {
            console.log('歌詞正在載入中，跳過重複請求');
            return;
        }
        this.isLoadingLyrics = true;

        this.updateStatus('lyrics', null); // 載入中
        this.showLyricsPlaceholder('🎵 正在載入歌詞...');

        try {
            console.log(`🎤 請求歌詞: ${this.currentTrack.artist} - ${this.currentTrack.name}`);
            
            const response = await fetch(`/api/lyrics/${encodeURIComponent(this.currentTrack.artist)}/${encodeURIComponent(this.currentTrack.name)}`);
            const data = await response.json();

            console.log('歌詞 API 回應:', data);

            // 檢查新的 API 響應格式
            if (data.success && data.lyrics && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
                // 驗證歌詞內容是否有效
                const validLyrics = data.lyrics.filter(line => {
                    const text = line.text || line;
                    return text && text.trim() !== '' && this.isValidText(text);
                });

                if (validLyrics.length > 0) {
                    this.lyrics = validLyrics;
                    this.lyricsType = data.type || 'plain';
                    this.currentLyricsTrackId = this.currentTrack.id; // 記錄當前歌詞對應的歌曲ID
                    this.displayLyrics();
                    this.updateStatus('lyrics', true);
                    console.log(`✅ 歌詞載入成功: ${validLyrics.length} 行 (${this.lyricsType}) 來源: ${data.source}`);
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
            this.showLyricsError('載入歌詞失敗');
        } finally {
            this.isLoadingLyrics = false;
        }
    }

    // 檢查文本是否有效（不是亂碼）
    isValidText(text) {
        if (!text || typeof text !== 'string') return false;
        
        // 檢查是否包含大量亂碼字符
        const garbledChars = /[�\uFFFD]/g;
        const garbledCount = (text.match(garbledChars) || []).length;
        
        // 如果亂碼字符超過文本長度的30%，視為無效
        if (garbledCount > text.length * 0.3) {
            return false;
        }
        
        // 檢查是否包含正常的字符（中文、英文、數字、標點符號）
        const normalChars = /[\u4e00-\u9fff\u3400-\u4dbf\w\s\-,.!?'"()[\]]/g;
        const normalCount = (text.match(normalChars) || []).length;
        
        // 如果正常字符少於50%，可能是亂碼
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
            // Convert simplified Chinese to traditional Chinese using s2twp
            if (typeof convertToTraditional === 'function') {
                text = convertToTraditional(text);
            }
            const timeAttr = this.lyricsType === 'synced' && line.time ? `data-time="${line.time}"` : '';
            return `<div class="lyrics-line" data-index="${index}" ${timeAttr}>${this.escapeHtml(text)}</div>`;
        }).join('');

        this.lyricsContent.innerHTML = lyricsHTML;

        // 添加同步歌詞指示器
        if (this.lyricsType === 'synced') {
            const indicator = document.createElement('div');
            indicator.className = 'sync-indicator';
            indicator.innerHTML = '🎵 同步歌詞';
            this.lyricsContent.insertBefore(indicator, this.lyricsContent.firstChild);
        }

        // 移除歌詞行的點擊事件（Apple Music 風格不允許點擊）
    }

    updateLyricsHighlight(currentTime) {
        if (!this.lyrics || this.lyrics.length === 0) return;

        let targetIndex = -1;

        if (currentTime !== undefined) {
            if (this.lyricsType === 'synced') {
                // 同步歌詞：根據精確時間匹配，減少延遲
                for (let i = 0; i < this.lyrics.length; i++) {
                    const line = this.lyrics[i];
                    const nextLine = this.lyrics[i + 1];
                    
                    // 減少容差，提高同步精度
                    const tolerance = 200; // 200ms 容差
                    if (line.time <= currentTime + tolerance && (!nextLine || nextLine.time > currentTime + tolerance)) {
                        targetIndex = i;
                        break;
                    }
                }
            } else {
                // 純文本歌詞：改進時間同步算法
                if (this.currentTrack && this.currentTrack.duration > 0) {
                    // 使用更精確的進度計算
                    const progressRatio = currentTime / this.currentTrack.duration;
                    // 減少時間偏移，讓歌詞更同步
                    const timeOffset = 500; // 0.5秒提前量
                    const adjustedProgress = Math.max(0, (currentTime - timeOffset) / this.currentTrack.duration);
                    targetIndex = Math.floor(adjustedProgress * this.lyrics.length);
                    targetIndex = Math.max(0, Math.min(targetIndex, this.lyrics.length - 1));
                }
            }
            
            // 只有在自動滾動開啟時才更新索引
            if (this.autoScroll) {
                this.currentLyricIndex = targetIndex;
            }
        }

        // 移除所有高亮
        const lyricsLines = this.lyricsContent.querySelectorAll('.lyrics-line');
        lyricsLines.forEach(line => {
            line.classList.remove('current');
        });

        // 高亮當前行
        if (this.currentLyricIndex >= 0 && this.currentLyricIndex < this.lyrics.length) {
            const currentLine = this.lyricsContent.querySelector(`[data-index="${this.currentLyricIndex}"]`);
            if (currentLine) {
                currentLine.classList.add('current');
                
                // 自動滾動到當前行（保持在視窗中央）
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
        // null 狀態保持預設樣式（載入中）
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

    // 播放控制方法
    updatePlayerControls() {
        if (!this.currentTrack) return;

        // 更新播放/暫停按鈕
        if (this.currentTrack.isPlaying) {
            this.playIcon.style.display = 'none';
            this.pauseIcon.style.display = 'block';
            // 移除播放指示器
            // this.playIndicator.style.display = 'block';
        } else {
            this.playIcon.style.display = 'block';
            this.pauseIcon.style.display = 'none';
            // this.playIndicator.style.display = 'none';
        }
    }

    async handlePlayPause() {
        if (!this.currentTrack) return;

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch('/api/player/play-pause', {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ isPlaying: this.currentTrack.isPlaying })
            });

            if (response.ok) {
                // 立即更新UI狀態
                this.currentTrack.isPlaying = !this.currentTrack.isPlaying;
                this.updatePlayerControls();
                
                // 稍後重新檢查狀態
                setTimeout(() => this.checkCurrentTrack(), 500);
            }
        } catch (error) {
            console.error('播放控制失敗:', error);
        }
    }

    async handlePrevious() {
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch('/api/player/previous', {
                method: 'POST',
                headers: headers
            });

            if (response.ok) {
                setTimeout(() => this.checkCurrentTrack(), 500);
            }
        } catch (error) {
            console.error('上一首失敗:', error);
        }
    }

    async handleNext() {
        try {
            const headers = {};
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch('/api/player/next', {
                method: 'POST',
                headers: headers
            });

            if (response.ok) {
                setTimeout(() => this.checkCurrentTrack(), 500);
            }
        } catch (error) {
            console.error('下一首失敗:', error);
        }
    }

    handleVolumeChange(volume) {
        // 即時更新顯示，但不立即發送請求（避免過多請求）
        this.volumeValue.textContent = `${volume}%`;
    }

    async setVolume(volume) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.sessionId) {
                headers['X-Session-Id'] = this.sessionId;
            }

            const response = await fetch('/api/player/volume', {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ volume: volume })
            });

            if (!response.ok) {
                console.error('音量設定失敗');
            }
        } catch (error) {
            console.error('音量控制失敗:', error);
        }
    }

    async loadNextTrackPreview() {
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
                // 如果 API 失敗，不顯示錯誤，只是不顯示下一首
                this.nextTrackName.textContent = '無下一首';
            }
        } catch (error) {
            console.error('載入下一首預覽失敗:', error);
            this.nextTrackName.textContent = '無下一首';
        }
    }

    showNextTrackPreview() {
        if (this.nextTrackPreview && this.nextTrackName.textContent !== '無下一首') {
            this.nextTrackPreview.style.display = 'block';
            
            // 清除之前的超時
            if (this.nextTrackPreviewTimeout) {
                clearTimeout(this.nextTrackPreviewTimeout);
            }
            
            // 5秒後隱藏預覽
            this.nextTrackPreviewTimeout = setTimeout(() => {
                this.nextTrackPreview.style.display = 'none';
            }, 5000);
        }
    }

    // 提取專輯封面顏色並更新背景
    extractColorsAndUpdateBackground(imageUrl) {
        // 使用代理服務器獲取圖片以避免 CORS 問題
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

    // 通過代理獲取圖片並提取顏色
    async fetchImageThroughProxy(imageUrl) {
        try {
            // 使用 fetch 獲取圖片數據
            const response = await fetch(`/api/extract-colors`, {
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
            // 降級：嘗試直接載入圖片（可能會因 CORS 失敗）
            return this.extractColorsDirectly(imageUrl);
        }
    }

    // 直接提取顏色（可能會因 CORS 失敗）
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
            
            // 嘗試不同的 CORS 設置
            img.crossOrigin = 'anonymous';
            img.src = imageUrl;
        });
    }

    // 提取主要顏色
    extractDominantColors(imageData) {
        const colorMap = new Map();
        
        // 採樣像素（每隔4個像素採樣一次以提高性能）
        for (let i = 0; i < imageData.length; i += 16) {
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];
            const a = imageData[i + 3];
            
            // 跳過透明像素
            if (a < 128) continue;
            
            // 量化顏色以減少顏色數量
            const quantizedR = Math.floor(r / 32) * 32;
            const quantizedG = Math.floor(g / 32) * 32;
            const quantizedB = Math.floor(b / 32) * 32;
            
            const colorKey = `${quantizedR},${quantizedG},${quantizedB}`;
            colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
        }
        
        // 排序並獲取最常見的顏色
        const sortedColors = Array.from(colorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([color]) => {
                const [r, g, b] = color.split(',').map(Number);
                return { r, g, b };
            });
        
        // 如果沒有足夠的顏色，使用預設值
        while (sortedColors.length < 3) {
            sortedColors.push({ r: 102, g: 126, b: 234 });
        }
        
        return sortedColors;
    }

    // 更新動態背景
    updateDynamicBackground(colors) {
        const body = document.body;
        
        // 創建漸層顏色
        const color1 = `rgb(${colors[0].r}, ${colors[0].g}, ${colors[0].b})`;
        const color2 = `rgb(${colors[1].r}, ${colors[1].g}, ${colors[1].b})`;
        const color3 = `rgb(${colors[2].r}, ${colors[2].g}, ${colors[2].b})`;
        
        // 創建動態背景樣式
        const backgroundStyle = `
            radial-gradient(circle at 20% 80%, ${color1} 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, ${color2} 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, ${color3} 0%, transparent 50%)
        `;
        
        // 平滑過渡到新背景
        body.style.backgroundImage = backgroundStyle;
        
        // 更新 CSS 變數以供其他元素使用
        document.documentElement.style.setProperty('--album-color-1', color1);
        document.documentElement.style.setProperty('--album-color-2', color2);
        document.documentElement.style.setProperty('--album-color-3', color3);
        
        // 添加動畫效果
        this.animateBackgroundPosition();
    }

    // 使用預設背景
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

    // 動畫背景位置
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
            }, 3000); // 3秒更新一次
        }
    } else {
        // 頁面顯示時恢復正常頻率
        if (window.spotifyPlayer && window.spotifyPlayer.updateInterval) {
            clearInterval(window.spotifyPlayer.updateInterval);
            window.spotifyPlayer.updateInterval = setInterval(() => {
                window.spotifyPlayer.checkCurrentTrack();
            }, 3000); // 3秒更新一次
        }
    }
});

// 儲存實例到全域變數以便調試
window.addEventListener('load', () => {
    if (!window.spotifyPlayer) {
        window.spotifyPlayer = new SpotifyLyricsPlayer();
    }
});