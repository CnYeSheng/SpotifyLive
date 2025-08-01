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
        
        this.initializeElements();
        this.bindEvents();
        this.handleAuthCallback();
        this.checkAuthStatus();
    }

    handleAuthCallback() {
        // 檢查是否從認證回調返回
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'success') {
            // 清除 URL 參數
            window.history.replaceState({}, document.title, window.location.pathname);
            // 顯示成功訊息
            this.showSuccessMessage('🎉 Spotify 連接成功！');
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
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/api/auth-status');
            const data = await response.json();
            
            if (data.authenticated) {
                this.showPlayerSection();
                this.startTracking();
            } else {
                this.showAuthSection();
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
        }, 3000); // 每3秒檢查一次
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
    }

    async checkCurrentTrack() {
        try {
            const response = await fetch('/api/current-track');
            
            if (response.status === 401) {
                this.showAuthSection();
                this.stopTracking();
                return;
            }

            const data = await response.json();
            
            if (!data.isPlaying || !data.name) {
                this.showNoMusicSection();
                return;
            }

            const isNewTrack = !this.currentTrack || 
                              this.currentTrack.id !== data.id ||
                              this.currentTrack.name !== data.name;

            this.currentTrack = data;
            this.currentTrack.lastUpdated = Date.now(); // 記錄更新時間
            this.updateTrackInfo();

            if (isNewTrack) {
                this.loadLyrics();
                this.updateProgress(); // 新歌立即開始更新進度
            } else {
                // 如果歌曲暫停後又播放，需要重新啟動動畫
                if (this.currentTrack.isPlaying && !this.animationFrameId) {
                    this.updateProgress();
                }
            }

            this.showPlayerSection();

        } catch (error) {
            console.error('獲取當前播放失敗:', error);
            this.updateStatus('spotify', false);
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
    }

    updateProgress() {
        if (!this.currentTrack || !this.currentTrack.isPlaying) return;

        const update = () => {
            if (!this.currentTrack.isPlaying) return;

            const elapsedTime = (Date.now() - this.currentTrack.lastUpdated) + this.currentTrack.progress;
            const progress = (elapsedTime / this.currentTrack.duration) * 100;
            
            this.progressFill.style.width = `${Math.min(100, progress)}%`;
            this.currentTime.textContent = this.formatTime(elapsedTime);

            this.updateLyricsHighlight(elapsedTime);

            if (elapsedTime < this.currentTrack.duration) {
                requestAnimationFrame(update);
            }
        };

        requestAnimationFrame(update);
    }

    async loadLyrics() {
        if (!this.currentTrack) return;

        this.updateStatus('lyrics', null); // 載入中
        this.showLyricsPlaceholder('🎵 正在載入歌詞...');

        try {
            console.log(`🎤 請求歌詞: ${this.currentTrack.artist} - ${this.currentTrack.name}`);
            
            const response = await fetch(`/api/lyrics/${encodeURIComponent(this.currentTrack.artist)}/${encodeURIComponent(this.currentTrack.name)}`);
            const data = await response.json();

            console.log('歌詞 API 回應:', data);

            if (data.success && data.lyrics && data.lyrics.length > 0) {
                this.lyrics = data.lyrics;
                this.lyricsType = data.type || 'plain';
                this.displayLyrics();
                this.updateStatus('lyrics', true);
                console.log(`✅ 歌詞載入成功: ${data.lyrics.length} 行 (${this.lyricsType})`);
            } else {
                const errorMsg = data.error || '找不到歌詞';
                console.log(`❌ 歌詞載入失敗: ${errorMsg}`);
                
                this.showLyricsPlaceholder(`😔 ${errorMsg}\n\n可能的原因:\n• 歌曲太新或太冷門\n• 歌詞數據庫中沒有此歌曲\n• 藝術家或歌曲名稱不匹配\n\n💡 嘗試播放其他熱門歌曲`);
                this.updateStatus('lyrics', false);
            }
        } catch (error) {
            console.error('載入歌詞失敗:', error);
            this.showLyricsPlaceholder('❌ 載入歌詞失敗\n\n請檢查網路連接或稍後再試\n\n🔧 如果問題持續，請檢查歌詞服務狀態');
            this.updateStatus('lyrics', false);
        }
    }

    showLyricsPlaceholder(text) {
        this.lyricsContent.innerHTML = `
            <div class="lyrics-placeholder">
                <p style="white-space: pre-line;">${text}</p>
            </div>
        `;
    }

    displayLyrics() {
        if (!this.lyrics || this.lyrics.length === 0) return;

        const lyricsHTML = this.lyrics.map((line, index) => {
            const text = this.lyricsType === 'synced' ? line.text : line.text || line;
            const timeAttr = this.lyricsType === 'synced' && line.time ? `data-time="${line.time}"` : '';
            return `<div class="lyrics-line" data-index="${index}" ${timeAttr}>${this.escapeHtml(text)}</div>`;
        }).join('');

        this.lyricsContent.innerHTML = lyricsHTML;

        // 添加同步歌詞指示器
        if (this.lyricsType === 'synced') {
            // const indicator = document.createElement('div');
            // indicator.className = 'sync-indicator';
            // indicator.innerHTML = '🎵 同步歌詞';
            this.lyricsContent.insertBefore(indicator, this.lyricsContent.firstChild);
        }

        // 添加點擊事件到歌詞行
        this.lyricsContent.querySelectorAll('.lyrics-line').forEach(line => {
            line.addEventListener('click', () => {
                const index = parseInt(line.dataset.index);
                this.currentLyricIndex = index;
                this.updateLyricsHighlight();
            });
        });
    }

    updateLyricsHighlight(currentTime) {
        if (!this.lyrics || this.lyrics.length === 0) return;

        let targetIndex = this.currentLyricIndex;

        if (this.autoScroll) {
            if (this.lyricsType === 'synced') {
                // 同步歌詞：根據精確時間匹配
                // const currentTime = this.currentTrack.progress;
                
                // 找到當前時間應該顯示的歌詞行
                for (let i = 0; i < this.lyrics.length; i++) {
                    const line = this.lyrics[i];
                    const nextLine = this.lyrics[i + 1];
                    
                    if (line.time <= currentTime && (!nextLine || nextLine.time > currentTime)) {
                        targetIndex = i;
                        break;
                    }
                }
            } else {
                // 純文本歌詞：使用時間估算
                const progressRatio = currentTime / this.currentTrack.duration;
                targetIndex = Math.floor(progressRatio * this.lyrics.length);
            }
            
            this.currentLyricIndex = Math.max(0, Math.min(targetIndex, this.lyrics.length - 1));
        }

        // 移除所有高亮
        this.lyricsContent.querySelectorAll('.lyrics-line').forEach(line => {
            line.classList.remove('current', 'upcoming');
        });

        // 添加當前行高亮
        const currentLine = this.lyricsContent.querySelector(`[data-index="${this.currentLyricIndex}"]`);
        if (currentLine) {
            currentLine.classList.add('current');
            
            // 為同步歌詞添加即將到來的行預覽
            if (this.lyricsType === 'synced') {
                const nextLine = this.lyricsContent.querySelector(`[data-index="${this.currentLyricIndex + 1}"]`);
                if (nextLine) {
                    nextLine.classList.add('upcoming');
                }
            }
            
            // 自動滾動到當前行
            if (this.autoScroll) {
                currentLine.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
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
            }, 100); // 10秒更新一次
        }
    } else {
        // 頁面顯示時恢復正常頻率
        if (window.spotifyPlayer && window.spotifyPlayer.updateInterval) {
            clearInterval(window.spotifyPlayer.updateInterval);
            window.spotifyPlayer.updateInterval = setInterval(() => {
                window.spotifyPlayer.checkCurrentTrack();
            }, 100); // 3秒更新一次
        }
    }
});

// 儲存實例到全域變數以便調試
window.addEventListener('load', () => {
    if (!window.spotifyPlayer) {
        window.spotifyPlayer = new SpotifyLyricsPlayer();
    }
});