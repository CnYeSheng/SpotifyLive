// 歌詞搜尋功能擴展
// 為 SpotifyLyricsPlayer 類添加歌詞搜尋和覆蓋功能

// 等待 SpotifyLyricsPlayer 類加载完成
document.addEventListener('DOMContentLoaded', function() {
    // 確保 SpotifyLyricsPlayer 已定義後再擴展
    if (typeof SpotifyLyricsPlayer !== 'undefined') {
        initLyricsSearchFeature();
    } else {
        // 如果還沒有定義，等待一下再試
        setTimeout(() => {
            if (typeof SpotifyLyricsPlayer !== 'undefined') {
                initLyricsSearchFeature();
            }
        }, 1000);
    }
});

function initLyricsSearchFeature() {
    // 擴展 SpotifyLyricsPlayer 類的原型，添加歌詞搜尋方法
    SpotifyLyricsPlayer.prototype.showLyricsSearchModal = function() {
    const modal = document.getElementById('lyrics-search-modal');
    const currentTrackInfo = document.getElementById('current-track-info');
    const currentTrackText = document.getElementById('current-track-text');
    const searchInput = document.getElementById('lyrics-search-input');
    
    // 如果有當前播放的歌曲，顯示當前歌曲信息
    if (this.currentTrack && this.currentTrack.name) {
        currentTrackInfo.style.display = 'block';
        currentTrackText.textContent = `${this.currentTrack.artist} - ${this.currentTrack.name}`;
        searchInput.value = `${this.currentTrack.artist} ${this.currentTrack.name}`;
    } else {
        currentTrackInfo.style.display = 'none';
        searchInput.value = '';
    }
    
    // 隱藏搜尋結果
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search-loading').style.display = 'none';
    
    modal.style.display = 'flex';
    searchInput.focus();
    this.log('🔍 顯示歌詞搜尋模態框');
};

SpotifyLyricsPlayer.prototype.hideLyricsSearchModal = function() {
    const modal = document.getElementById('lyrics-search-modal');
    modal.style.display = 'none';
    this.log('❌ 隱藏歌詞搜尋模態框');
};

SpotifyLyricsPlayer.prototype.performLyricsSearch = async function() {
    const searchInput = document.getElementById('lyrics-search-input');
    const query = searchInput.value.trim();
    
    if (!query) {
        this.showErrorMessage('請輸入搜尋內容');
        return;
    }

    this.log(`🔍 開始搜尋歌詞: ${query}`);
    
    // 顯示載入狀態
    document.getElementById('search-loading').style.display = 'flex';
    document.getElementById('search-results').style.display = 'none';
    
    try {
        // 解析查詢：嘗試分離歌手與歌名
        let artist = '', title = '';
        const parts = query.split(/[-–\s]+/);
        if (parts.length >= 2) {
            artist = parts[0].trim();
            title = parts.slice(1).join(' ').trim();
        } else {
            title = query.trim();
        }

        // 定義三個來源
        const providers = ['musixmatch', 'lrclib', 'netease'];
        const allResults = [];

        // 並行搜尋三個來源
        await Promise.all(providers.map(async (provider) => {
            try {
                const proxyUrl = `/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}`;
                this.log(`📡 搜尋 ${provider}: ${proxyUrl}`);
                
                const response = await fetch(proxyUrl);
                const data = await response.json();
                
                if (data.success && data.results && data.results.length > 0) {
                    // 取第一個結果（通常只有一個）
                    const result = data.results[0];
                    result.provider = provider; // 標記來源
                    allResults.push(result);
                    this.log(`✅ ${provider} 找到歌詞`);
                } else {
                    this.log(`❌ ${provider} 無歌詞`);
                }
            } catch (error) {
                this.log(`❌ ${provider} 搜尋失敗: ${error.message}`);
            }
        }));

        // 顯示結果
        if (allResults.length > 0) {
            this.displaySearchResults(allResults);
        } else {
            this.displayNoResults();
        }
    } catch (error) {
        this.log(`❌ 搜尋歌詞失敗: ${error.message}`);
        this.showErrorMessage('搜尋失敗，請稍後重試');
    } finally {
        document.getElementById('search-loading').style.display = 'none';
    }
};

SpotifyLyricsPlayer.prototype.searchCurrentTrackLyrics = function() {
    if (this.currentTrack && this.currentTrack.name) {
        const searchInput = document.getElementById('lyrics-search-input');
        searchInput.value = `${this.currentTrack.artist} ${this.currentTrack.name}`;
        this.performLyricsSearch();
    }
};

SpotifyLyricsPlayer.prototype.displaySearchResults = function(results) {
    const searchResults = document.getElementById('search-results');
    const resultsContainer = document.getElementById('results-container');
    
    resultsContainer.innerHTML = '';
    
    results.forEach(result => {
        const resultElement = document.createElement('div');
        resultElement.className = 'result-item';
        
        // 來源顯示（中文化）
        const sourceNames = {
            'musixmatch': 'Musixmatch',
            'lrclib': 'LrcLib',
            'netease': '網易雲'
        };
        const sourceName = sourceNames[result.provider] || result.provider;
        
        let preview = '點擊查看歌詞';
        if (result.lyrics && result.lyrics.length > 0) {
            const firstFewLines = result.lyrics.slice(0, 3)
                .map(line => typeof line === 'string' ? line : line.text || '')
                .filter(line => line.trim() !== '')
                .join(' / ');
            preview = firstFewLines.length > 100 ? firstFewLines.substring(0, 100) + '...' : firstFewLines;
        }
        
        resultElement.innerHTML = `
            <div class="result-title">${this.escapeHtml(result.title)}</div>
            <div class="result-artist">${this.escapeHtml(result.artist)}</div>
            <div class="result-preview">${this.escapeHtml(preview)}</div>
            <span class="result-source">${this.escapeHtml(sourceName)}</span>
        `;
        
        resultElement.addEventListener('click', () => {
            this.selectLyricsResult(result);
        });
        
        resultsContainer.appendChild(resultElement);
    });
    
    searchResults.style.display = 'block';
};

SpotifyLyricsPlayer.prototype.displayNoResults = function() {
    const searchResults = document.getElementById('search-results');
    const resultsContainer = document.getElementById('results-container');
    
    resultsContainer.innerHTML = `
        <div class="no-results">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <div>沒有找到相關歌詞</div>
            <div style="font-size: 14px; margin-top: 8px;">請嘗試其他關鍵字</div>
        </div>
    `;
    
    searchResults.style.display = 'block';
};

SpotifyLyricsPlayer.prototype.selectLyricsResult = async function(result) {
    this.log(`✅ 選擇歌詞: ${result.artist} - ${result.title}`);
    
    // 顯示載入狀態
    document.getElementById('search-loading').style.display = 'flex';
    document.getElementById('search-results').style.display = 'none';
    
    try {
        if (result.lyrics && result.lyrics.length > 0) {
            // 直接使用搜尋結果中的歌詞數據
            this.overrideLyrics(result.lyrics, result.type || 'plain', result);
            this.hideLyricsSearchModal();
            this.showSuccessMessage(`✅ 已載入歌詞: ${result.artist} - ${result.title}`);
        } else {
            this.showErrorMessage('歌詞數據無效');
            document.getElementById('search-results').style.display = 'block';
        }
    } catch (error) {
        this.log(`❌ 載入歌詞失敗: ${error.message}`);
        this.showErrorMessage('載入歌詞失敗，請稍後重試');
        document.getElementById('search-results').style.display = 'block';
    } finally {
        document.getElementById('search-loading').style.display = 'none';
    }
};

SpotifyLyricsPlayer.prototype.overrideLyrics = function(lyrics, lyricsType, source) {
    this.log(`🔄 覆蓋歌詞: ${lyrics.length} 行，類型: ${lyricsType}`);
    
    // 更新歌詞數據
    this.lyrics = lyrics;
    this.lyricsType = lyricsType || 'plain';
    this.currentLyricIndex = 0;
    
    // 標記為手動覆蓋
    this.isLyricsOverridden = true;
    this.overriddenLyricsSource = source;
    
    // 重新顯示歌詞
    this.displayLyrics();
    this.updateStatus('lyrics', true);
    
    // 添加覆蓋提示
    this.addLyricsOverrideIndicator(source);
};

SpotifyLyricsPlayer.prototype.addLyricsOverrideIndicator = function(source) {
    // 在歌詞區域顯示覆蓋提示
    const lyricsHeader = document.querySelector('.lyrics-header h3');
    if (lyricsHeader && !lyricsHeader.querySelector('.override-indicator')) {
        const indicator = document.createElement('span');
        indicator.className = 'override-indicator';
        indicator.innerHTML = `<small style="color: var(--accent-color); margin-left: 8px;">🔄 已覆蓋</small>`;
        indicator.title = `歌詞來源: ${source.artist} - ${source.title}`;
        lyricsHeader.appendChild(indicator);
        
        // 5秒後自動移除提示
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 5000);
    }
};

// 輔助方法
SpotifyLyricsPlayer.prototype.escapeHtml = function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

SpotifyLyricsPlayer.prototype.showErrorMessage = function(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #dc3545, #e74c3c);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(220, 53, 69, 0.3);
        z-index: 1001;
        font-weight: 600;
        animation: slideIn 0.3s ease;
        max-width: 300px;
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
};

    console.log('✅ 歌詞搜尋功能已加載');
}