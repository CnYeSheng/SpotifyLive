class SpotifyLyricsPlayer {
    constructor() {
        this.currentTrack = null;
        this.lyrics = [];
        this.currentLyricIndex = 0;
        this.autoScroll = true;
        this.fontSize = 'medium';
        this.updateInterval = null;
        this.lyricsUpdateTimeout = null;
        
        this.initializeElements();
        this.bindEvents();
        this.checkAuthStatus();
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

            // 檢查是否是新歌曲
            const isNewTrack = !this.currentTrack || 
                              this.currentTrack.id !== data.id ||
                              this.currentTrack.name !== data.name;

            this.currentTrack = data;
            this.updateTrackInfo();
            this.updateProgress();

            if (isNewTrack) {
                this.loadLyrics();
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
        if (!this.currentTrack) return;

        const progress = (this.currentTrack.progress / this.currentTrack.duration) * 100;
        this.progressFill.style.width = `${progress}%`;
        this.currentTime.textContent = this.formatTime(this.currentTrack.progress);

        // 更新歌詞高亮
        this.updateLyricsHighlight();
    }

    async loadLyrics() {
        if (!this.currentTrack) return;

        this.updateStatus('lyrics', null); // 載入中
        this.showLyricsPlaceholder('🎵 正在載入歌詞...');

        try {
            const response = await fetch(`/api/lyrics/${encodeURIComponent(this.currentTrack.artist)}/${encodeURIComponent(this.currentTrack.name)}`);
            const data = await response.json();

            if (data.lyrics && data.lyrics.length > 0) {
                this.lyrics = data.lyrics;
                this.displayLyrics();
                this.updateStatus('lyrics', true);
            } else {
                this.showLyricsPlaceholder('😔 找不到歌詞\n\n可能是因為:\n• 歌曲太新或太冷門\n• 歌詞數據庫中沒有此歌曲\n• 藝術家或歌曲名稱不匹配');
                this.updateStatus('lyrics', false);
            }
        } catch (error) {
            console.error('載入歌詞失敗:', error);
            this.showLyricsPlaceholder('❌ 載入歌詞失敗\n\n請檢查網路連接或稍後再試');
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

        const lyricsHTML = this.lyrics.map((line, index) => 
            `<div class="lyrics-line" data-index="${index}">${this.escapeHtml(line)}</div>`
        ).join('');

        this.lyricsContent.innerHTML = lyricsHTML;

        // 添加點擊事件到歌詞行
        this.lyricsContent.querySelectorAll('.lyrics-line').forEach(line => {
            line.addEventListener('click', () => {
                const index = parseInt(line.dataset.index);
                this.currentLyricIndex = index;
                this.updateLyricsHighlight();
            });
        });
    }

    updateLyricsHighlight() {
        if (!this.lyrics || this.lyrics.length === 0) return;

        // 簡單的時間估算：假設歌詞平均分佈在整首歌中
        const progressRatio = this.currentTrack.progress / this.currentTrack.duration;
        const estimatedIndex = Math.floor(progressRatio * this.lyrics.length);
        
        // 更新當前歌詞索引（如果沒有手動選擇）
        if (this.autoScroll) {
            this.currentLyricIndex = Math.max(0, Math.min(estimatedIndex, this.lyrics.length - 1));
        }

        // 移除所有高亮
        this.lyricsContent.querySelectorAll('.lyrics-line').forEach(line => {
            line.classList.remove('current');
        });

        // 添加當前行高亮
        const currentLine = this.lyricsContent.querySelector(`[data-index="${this.currentLyricIndex}"]`);
        if (currentLine) {
            currentLine.classList.add('current');
            
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
            }, 10000); // 10秒更新一次
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