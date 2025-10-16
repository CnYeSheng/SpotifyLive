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

// 修復 performLyricsSearch 方法中的 URL 構建
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
        // 更智能的查詢解析：優先使用「-」分隔，其次使用空格
        let artist = '';
        let title = '';
        
        if (query.includes(' - ')) {
            // 格式: "Artist - Title"
            const parts = query.split(' - ');
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
        } else if (query.includes('-')) {
            // 格式: "Artist-Title" (無空格)
            const parts = query.split('-');
            artist = parts[0].trim();
            title = parts.slice(1).join('-').trim();
        } else {
            // 只有標題，或空格分隔
            // 嘗試按空格分割，第一個單詞作為藝術家
            const parts = query.split(/\s+/);
            if (parts.length >= 2) {
                artist = parts[0];
                title = parts.slice(1).join(' ');
            } else {
                title = query;
            }
        }

        // 定義三個來源
        const providers = ['Musixmatch', 'Lrclib', 'NetEase'];
        const allResults = [];

        // 並行搜尋三個來源
        await Promise.all(providers.map(async (provider) => {
            try {
                // 修復：正確的 URL 格式是 /api/lyrics/{title}/{artist}?p={provider}
                const encodedTitle = encodeURIComponent(title);
                const encodedArtist = encodeURIComponent(artist);
                const lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodedTitle}/${encodedArtist}?p=${provider}`;
                
                this.log(`📡 搜尋 ${provider}: ${lyricsUrl}`);
                
                const response = await fetch(lyricsUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    this.log(`❌ ${provider} HTTP ${response.status}`);
                    return;
                }
                
                const data = await response.json();
                
                if (data.success && data.results && data.results.length > 0) {
                    // 取第一個結果
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

// 修復自動載入歌詞時的搜尋邏輯（在 loadLyrics 中）
SpotifyLyricsPlayer.prototype.loadLyrics = async function() {
    // 添加歌詞供應商鎖定功能
    this.selectedLyricsProvider = localStorage.getItem(`lyrics_provider_${this.currentTrack.id}`) || null;
    
    if (!this.currentTrack || !this.currentTrack.name || !this.currentTrack.artist) {
        this.log('❌ 無效的歌曲信息，無法加載歌詞');
        this.showLyricsError('無效的歌曲信息');
        return;
    }

    // 清理歌手名稱（移除多餘的逗號）
    const cleanArtist = this.currentTrack.artist.trim().replace(/,\s*$/g, '').split(',')[0].trim();
    const cleanTitle = this.currentTrack.name.trim().replace(/,\s*$/g, '').trim();

    // 防止重複載入相同歌曲的歌詞
    const trackId = this.currentTrack.id || `${cleanArtist}-${cleanTitle}`;
    if (this.currentLyricsTrackId === trackId && this.lyrics.length > 0) {
        this.log('⏭️ 歌詞已載入，跳過重複載入');
        return;
    }

    // 檢查是否正在載入歌詞
    if (this.isLoadingLyrics) {
        this.log('⏳ 歌詞正在載入中，跳過重複請求');
        return;
    }

    this.isLoadingLyrics = true;
    this.currentLyricsTrackId = trackId;

    // 清除之前的歌詞載入超時
    if (this.lyricsLoadTimeout) {
        clearTimeout(this.lyricsLoadTimeout);
        this.lyricsLoadTimeout = null;
    }

    // 設置歌詞載入超時（30秒）
    this.lyricsLoadTimeout = setTimeout(() => {
        if (this.isLoadingLyrics) {
            this.log('⏰ 歌詞載入超時');
            this.isLoadingLyrics = false;
            this.showLyricsError('歌詞載入超時，請稍後重試');
        }
    }, 30000);

    this.log(`🎵 開始載入歌詞: ${cleanArtist} - ${cleanTitle}`);
    this.showLyricsLoading();
    this.updateStatus('lyrics', false);

    try {
        // 使用新的歌詞 API，優先使用已選定的供應商
        const encodedTitle = encodeURIComponent(cleanTitle);
        const encodedArtist = encodeURIComponent(cleanArtist);
        
        let lyricsUrl;
        if (this.selectedLyricsProvider) {
            // 如果有選定的供應商，直接使用該供應商
            lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodedTitle}/${encodedArtist}?p=${this.selectedLyricsProvider}`;
            this.log(`🎯 使用已選定的歌詞供應商: ${this.selectedLyricsProvider}`);
        } else {
            // 如果沒有選定供應商，嘗試多個來源
            lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodedTitle}/${encodedArtist}`;
            this.log(`🔍 使用默認歌詞 API 搜尋歌詞`);
        }

        // 記錄請求
        this.lastLyricsRequest = {
            url: lyricsUrl,
            artist: cleanArtist,
            title: cleanTitle,
            timestamp: Date.now()
        };

        const response = await fetch(lyricsUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success || !data.results || data.results.length === 0) {
            throw new Error('沒有找到歌詞');
        }

        // 取第一個結果
        const result = data.results[0];
        
        if (!result.lyrics || result.lyrics.length === 0) {
            throw new Error('歌詞數據為空');
        }

        // 處理歌詞數據
        this.lyrics = Array.isArray(result.lyrics) ? result.lyrics : [];
        this.lyricsType = result.type || 'plain';
        
        // 記錄成功載入的供應商信息
        if (result.provider && !this.selectedLyricsProvider) {
            this.log(`✅ 成功載入歌詞，供應商: ${result.provider}`);
        }

        this.currentLyricIndex = 0;
        this.displayLyrics();
        this.updateStatus('lyrics', true);

        this.log(`✅ 歌詞載入成功: ${this.lyrics.length} 行 (${this.lyricsType})`);

    } catch (error) {
        this.log(`❌ 歌詞載入失敗: ${error.message}`);
        this.showLyricsError(`載入歌詞失敗: ${error.message}`);
        this.updateStatus('lyrics', false);
    } finally {
        this.isLoadingLyrics = false;
        
        // 清除超時定時器
        if (this.lyricsLoadTimeout) {
            clearTimeout(this.lyricsLoadTimeout);
            this.lyricsLoadTimeout = null;
        }
    }
};

// 也修復自動搜尋的查詢解析（在 script.js 的 showLyricsError 中調用的搜尋）
SpotifyLyricsPlayer.prototype.buildLyricsSearchQuery = function(artist, title) {
    // 清理多個逗號或奇怪的字符
    const cleanArtist = (artist || '').trim().replace(/,\s*$/g, '').split(',')[0].trim();
    const cleanTitle = (title || '').trim().replace(/,\s*$/g, '').trim();
    
    return {
        artist: cleanArtist,
        title: cleanTitle
    };
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
            'Musixmatch': 'Musixmatch',
            'Lrclib': 'LrcLib',
            'NetEase': '網易雲'
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
    this.log(`✅ 選擇歌詞: ${result.artist} - ${result.title} (供應商: ${result.provider})`);
    
    // 顯示載入狀態
    document.getElementById('search-loading').style.display = 'flex';
    document.getElementById('search-results').style.display = 'none';
    
    try {
        if (result.lyrics && result.lyrics.length > 0) {
            // 鎖定該歌曲的歌詞供應商
            if (this.currentTrack && this.currentTrack.id && result.provider) {
                localStorage.setItem(`lyrics_provider_${this.currentTrack.id}`, result.provider);
                this.selectedLyricsProvider = result.provider;
                this.log(`🔒 已鎖定歌曲 "${this.currentTrack.name}" 的歌詞供應商為: ${result.provider}`);
            }
            
            // 直接使用搜尋結果中的歌詞數據
            this.overrideLyrics(result.lyrics, result.type || 'plain', result);
            this.hideLyricsSearchModal();
            
            // 顯示成功訊息，包含供應商信息
            const providerNames = {
                'Musixmatch': 'Musixmatch',
                'Lrclib': 'LrcLib',
                'NetEase': '網易雲'
            };
            const providerDisplayName = providerNames[result.provider] || result.provider;
            this.showSuccessMessage(`✅ 已載入歌詞 (${providerDisplayName}): ${result.artist} - ${result.title}`);
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