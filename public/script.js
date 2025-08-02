class SpotifyLyricsPlayer {
    constructor() {
        this.currentTrack = null;
        this.lyrics = [];
        this.lyricsType = 'plain'; // 'synced' 或 'plain'
        this.currentLyricIndex = -1; // 默认为-1，表示无高亮行
        this.autoScroll = true;
        this.fontSize = 'medium';
        this.updateInterval = null;
        this.lyricsUpdateTimeout = null;
        this.animationFrameId = null;
        this.retryCount = 0; // 添加重试计数器
        this.maxRetries = 3; // 最大重试次数
        
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
    }

    async checkCurrentTrack() {
        try {
            const response = await fetch('/api/current-track');
            
            if (response.status === 401) {
                this.showAuthSection();
                this.stopTracking();
                return;
            }

            if (!response.ok) {
                console.error(`API 錯誤: ${response.status} ${response.statusText}`);
                // 添加重试机制
                if (response.status >= 500 && this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    console.log(`服务器错误，第${this.retryCount}次重试...`);
                    setTimeout(() => this.checkCurrentTrack(), 5000);
                    return;
                } else if (response.status >= 500) {
                    console.error('达到最大重试次数，停止重试');
                }
                // 不要立即隱藏播放器，可能是暫時的網路問題
                this.updateStatus('spotify', false);
                return;
            }
            
            // 重置重试计数器
            this.retryCount = 0;

            const data = await response.json();
            
            // 如果没有歌曲数据，显示无音乐页面
            if (!data.name) {
                this.showNoMusicSection();
                return;
            }
            
            // 如果有歌曲但暂停了，仍然显示播放器页面

            const isNewTrack = !this.currentTrack || 
                              this.currentTrack.id !== data.id ||
                              this.currentTrack.name !== data.name;

            this.currentTrack = data;
            this.currentTrack.lastUpdated = Date.now(); // 記錄更新時間
            this.updateTrackInfo();

            if (isNewTrack) {
                this.loadLyrics();
            }
            
            // 无论是否为新歌，都要更新进度（包括暂停状态）
            this.updateProgress();

            this.showPlayerSection();
            this.updateStatus('spotify', true);

        } catch (error) {
            console.error('獲取當前播放失敗:', error);
            this.updateStatus('spotify', false);
            // 網路錯誤時不要隱藏播放器，添加重试机制
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`网络错误，第${this.retryCount}次重试...`);
                setTimeout(() => this.checkCurrentTrack(), 5000);
            } else {
                console.error('达到最大重试次数，停止重试');
            }
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

        this.updateStatus('lyrics', null); // 載入中
        this.showLyricsPlaceholder('🎵 正在載入歌詞...');
        this.currentLyricIndex = -1; // 重置歌词索引

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
        }
    }

    // 檢查文本是否有效（不是亂碼）
    isValidText(text) {
        if (!text || typeof text !== 'string') return false;
        
        // 檢查是否包含大量亂碼字符
        const garbledChars = /[\uFFFD]/g;
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
            // Convert simplified Chinese to traditional Chinese
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

        let targetIndex = -1; // 預設為 -1，表示還沒到歌詞

        if (this.autoScroll && currentTime !== undefined) {
            if (this.lyricsType === 'synced') {
                // 同步歌詞：根據精確時間匹配
                for (let i = 0; i < this.lyrics.length; i++) {
                    const line = this.lyrics[i];
                    const nextLine = this.lyrics[i + 1];
                    
                    // 添加容差处理，解决歌词不同步问题
                    const tolerance = 300; // 300ms 容差，提高精度
                    if (line.time <= currentTime + tolerance && (!nextLine || nextLine.time > currentTime + tolerance)) {
                        targetIndex = i;
                        break;
                    }
                }
            } else {
                // 純文本歌詞：根據時間同步，但稍微延遲一點
                const progressRatio = currentTime / this.currentTrack.duration;
                // 调整时间偏移，解决歌词不同步问题
                const timeOffset = 500; // 0.5秒提前量，提高同步性
                const adjustedProgress = Math.max(0, (currentTime - timeOffset) / this.currentTrack.duration);
                targetIndex = Math.floor(adjustedProgress * this.lyrics.length);
                targetIndex = Math.max(0, Math.min(targetIndex, this.lyrics.length - 1));
            }
        }

        // 只有当索引发生变化时才更新高亮
        if (this.currentLyricIndex !== targetIndex) {
            // 移除所有高亮
            this.lyricsContent.querySelectorAll('.lyrics-line').forEach(line => {
                line.classList.remove('current');
            });

            this.currentLyricIndex = targetIndex;

            // 只有當 targetIndex >= 0 時才添加高亮
            if (this.currentLyricIndex >= 0) {
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